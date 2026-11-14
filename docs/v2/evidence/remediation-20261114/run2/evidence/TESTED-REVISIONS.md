# Tested revisions and carry-forward to `e8666c17` (run 2, scope `evidence`)

Audit of run 1's claims. **The orchestrator re-runs everything at the final revision (RUN-PLAN-2 P2-08); this table is not a substitute for that.** Carry-forward is by file identity: a result carries to
`e8666c17` only if no file in the check's inputs changed between the tested revision and `e8666c17` (`git diff --name-only <tested>..e8666c17`). Inputs = for a test file, its transitive TS import closure (`@/` and
relative imports) plus the files it names itself via string literals/`join(...)`; plus `package-lock.json`, `vitest.config.mts`, `tests/setup.ts`, `tsconfig.json`; for integration tests also `src/db/migrations/**`,
`tests/integration/guard*`, `packages/testing/**`. For typecheck, lint and build: every `src|tests|tools` `.ts/.tsx/.mts` file. This is an approximation (see the limits at the end); data inputs (the snapshot, the python venv) are
assumed the same as run 1's.

## 1. Code identity of the candidate

| Fact | Evidence |
|---|---|
| `6c8b02cd..e8666c17` and `3aa82166..e8666c17` change **no** file under `src`, `tools`, `deploy`, `tests`, `data`, `package.json`, `package-lock.json` | `git diff --name-only 3aa82166..e8666c17 -- src tools deploy tests data package.json package-lock.json` is empty; the only non-evidence files that differ are `CHANGELOG.md`, `IssuesIndex.md`, `blockers.md`, `issues.md` and `docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md` |
| No test or tool reads those five records files | `grep` over `tests tools src deploy` for each name: only comments (`tests/v2-fixture-contract.test.ts:5`, `tools/migration/import_draft.py:49`, `tests/deploy-web-unit.test.ts:313`, `tests/settle-season-revalidation.test.ts:1075`) and `tools/v2/issue350-season-open-production.ts` text strings name them; none opens them |
| `package.json` differs from `de640826` by one added script (`lint:gate`); `package-lock.json`, `vitest.config.mts`, `tests/setup.ts`, `tsconfig.json` are identical to `de640826` | `git diff de640826..e8666c17 -- package.json package-lock.json vitest.config.mts tests/setup.ts tsconfig.json` |
| `a119a999..e8666c17` changes exactly 15 non-evidence files: `src/db/queries/admin-coaches.ts`, `src/lib/auth/session.ts`, `src/search/nl/parser.ts`, `tests/auth.test.ts`, `tests/deploy-web-unit.test.ts`, `tests/integration/admin-coaches.test.ts`, `tests/nl-parser.test.ts`, `tests/special-records-public-filter-contract.test.ts`, `tools/maintenance/offhost-pull.sh`, `tools/maintenance/scheduled-backup.sh`, `tools/v2/issue350-season-open-production.ts`, `tools/v2/season-opening-check.ts`, `deploy/afldb-backup.service`, `deploy/afldb-backup-verify.service`, `docs/backup-restore.md` | `git diff --name-only a119a999..e8666c17` |

Consequence: any result obtained at `3aa82166` or `6c8b02cd` is a result for the code of `e8666c17`. A result at `a119a999` is one only for suites whose inputs avoid those 15 files.

## 2. QUALIFICATION.md §1–§5

Evidence paths are under `docs/v2/evidence/remediation-20261114/qualification/` unless marked host. The §1 revision is recorded only on the host (`/mnt/ssd/afldb-rem-int-20261114/evidence/sync_rev.log`: `HEAD=a119a999d579…`, `porcelain=0`, checkout first at `5394aff8` then moved); the committed `broad-a119a999/` files do not name it.

| § | Check | Tested revision | Evidence | Result (as recorded) | Carries to `e8666c17`? | Why |
|---|---|---|---|---|---|---|
| 1 | Typecheck | `a119a999` | broad-a119a999/tsc.log | PASS rc 0 | No (superseded: YES via 6c8b02cd) | 15 changed files include `src/` and `tests/` .ts; the identical check at `6c8b02cd` passed (`final-6c8b02cd/tsc.log`), code-identical to `e8666c17` |
| 1 | Lint `eslint .` | `a119a999` | broad-a119a999/lint.log, eslint.json.gz | 338 errors / 146 warnings | No (superseded: gate at 6c8b02cd) | changed `src`/`tests` files can change counts; the gate at `6c8b02cd` recomputed 338 (`final-6c8b02cd/lint-gate.log`). A full `eslint .` was not repeated at `6c8b02cd` |
| 1 | Lint gate (`lint:gate`) | `a119a999` | broad-a119a999/lint.log; final-6c8b02cd/lint-gate.log | PASS (338 allowed 338) | Yes (the 6c8b02cd run) | code-identical |
| 1 | Unit `vitest run` | `a119a999` | broad-a119a999/unit.json.gz | 8 failed / 12,108 passed / 31 skipped | No (superseded: YES via 6c8b02cd) | changed: `tests/auth.test.ts`, `nl-parser.test.ts`, `deploy-web-unit.test.ts`, `special-records-...contract.test.ts` and 3 `src`/`tools` files. At `6c8b02cd`: 12,125 passed / 6 failed / 25 skipped (non-integration files, re-split from `final-6c8b02cd/unit.json.gz`: 12,125 / 6 / 25 — I reproduce it) |
| 1 | `tests/restore-test.test.sh` | `a119a999` | broad-a119a999/restore-test-sh.log | PASS 24/0 | Yes | neither `tests/restore-test.test.sh` nor `tools/maintenance/restore-test.sh` changed (`git diff --name-only a119a999..e8666c17` lists only `scheduled-backup.sh`, `offhost-pull.sh`) |
| 1 | `tests/sync-dev-remote.test.sh` (+ payloads from `sync-dev-static.test.ps1`) | `a119a999` | broad-a119a999/sync-dev-remote-sh.log | PASS 86/0 | Yes | no `deploy/sync-dev*` or `tests/sync-dev*` file changed |
| 1 | PowerShell tests (Windows PowerShell 5.1, workstation) | `not recorded` | **none committed** | PASS 4/4 | Unverifiable from the record; inputs unchanged | no `tests/*.ps1` or `deploy/sync-dev.ps1` change since `a119a999`; neither the revision nor the log is in `qualification/` |
| 1 | Integration, one shared copy, full parallel | `a119a999` | broad-a119a999/integration.json.gz | 99 failed / 3,160 passed (+2 expected-fail, 345 skipped) | Per file: see section 4 | 76 of 99 integration files have no changed file in their import closure; 23 do (3 files: `admin-coaches.ts`, `session.ts`, `parser.ts`) |
| 1 | Production build `next build --webpack` | `a119a999` | broad-a119a999/build-next.log | FAIL (`next/font` Google loader) | n/a (failure was transient) | retried at `3aa82166`, below |
| 2 | Delta run (review A fixes) | `e905915a` | delta/delta-e905915a.out | tsc rc 0; 1,900 passed / 1 failed (the off-host pull test helper) | No | the failing helper was fixed in `3aa82166` (`tests/deploy-web-unit.test.ts` changed) |
| 2 | Delta run | `3aa82166` | delta/delta-3aa82166.out | tsc rc 0; `deploy-web-unit` + `special-records-...contract` 50/50 | Yes | code-identical |
| 2 | Review B fixes (admin mint epoch, NL minimum-one) | `48286d7a` | (covered by the 6c8b02cd unit run) | no separate run | Yes via 6c8b02cd | `tests/auth.test.ts` and `tests/nl-parser.test.ts` ran in the `6c8b02cd` unit run |
| 2 | Final code state: typecheck, lint gate, unit | `6c8b02cd` | final-6c8b02cd/{tsc.log,lint-gate.log,unit.json.gz} | tsc PASS; gate PASS 338; unit 12,125 / 6 / 25 | Yes | code-identical (`6c8b02cd..e8666c17` is records only) |
| 3 | `settle-afltables` | `3aa82166` | iso-3aa82166/settle.json.gz | PASS 85/85 | Yes | code-identical |
| 3 | `afl-api-c7-observation` | `3aa82166` | iso-3aa82166/c7.json.gz | PASS 6/6 | Yes | code-identical |
| 3 | `awards-reload-links` | `3aa82166` | iso-3aa82166/awards.json.gz | 97 passed / 10 skipped; 2 describe-level errors | Yes | code-identical |
| 3 | `data-editor` + `prep-authority.mjs` | `3aa82166` | iso-3aa82166/dataeditor.json.gz | PASS 62 / 1 skipped | Yes | code-identical (the prep script is a host scratch input) |
| 3 | `admin-coaches` | `3aa82166` | iso-3aa82166/admincoaches.json.gz | PASS 18/18 | Yes | code-identical |
| 3 | `gridley-corpus` | `3aa82166` | iso-3aa82166/gridley.json.gz | 1,211 passed / 1 failed | Yes | code-identical |
| 3 | `release-gates` + `admin-season-lists` | `3aa82166` | iso-3aa82166/gates.json.gz | 94 passed / 8 failed / 7 skipped | Yes | code-identical |
| 3 | Production build + `prepare-standalone` | `3aa82166` | iso-3aa82166/build-next.log, build-standalone.log (raw CR bytes restored by this scope) | PASS, BUILD_ID `GciqAlQ-EN8HR4V6tU-aP` | Yes | code-identical; `package-lock.json` unchanged |
| 3 | Parse-only V5 corpus (12,000) | `3aa82166` | iso-3aa82166/parse.log, corpus-diff-parse.jsonl | 12,000 / 0 / 0, `PARSER_VERSION` 68, 0 changed | Yes | code-identical (corpus files are inputs: unchanged) |
| 3 | DraftGuru Stage A (read-only copy of DEV `annual-html-20260826`) | `3aa82166` | iso-3aa82166/stagea-*.log, stagea-{src,dst}.sha | vitest 215 / 2 / 1 (no JSON committed); 13 python contracts exit 0 | Yes, as recorded | code-identical. The copy (`cand/data/...`) is gone from the host, and the vitest counts have no committed JSON |
| 4 | `club-comparison` + `club-comparison-route` | `3aa82166` | iso2-3aa82166/clubcmp.json.gz | 76 passed / 24 failed | Yes | code-identical |
| 4 | `settle-afl-api` | `3aa82166` | iso2-3aa82166/settleapi.json.gz | 73 passed / 1 failed | Yes | code-identical |
| 4 | `player-matching` + `player-link-concurrency` | `3aa82166` | iso2-3aa82166/matching.json.gz | PASS 31/31 | Yes | code-identical |
| 4 | `admin-draft` + `admin-special-records` + `match-admin-delete` | `3aa82166` | iso2-3aa82166/admindraft.json.gz | PASS 103/103 | Yes | code-identical |
| 4 | `database` + `draft-linkage` + `admin-brownlow` | `3aa82166` | iso2-3aa82166/misc.json.gz | 120 passed / 7 failed | Yes | code-identical |
| 5 | Visual S1/S2/S2b/S3, desktop and mobile | `3aa82166` | visual/report-v2.json, report-v3.json, *.png | PASS (5 checks) | Yes | `git diff 3aa82166..e8666c17 -- src` is empty; the build is the same tree |
| 5 | Sitemap on the integrated build, `AFLDB_INDEXING=on` | `3aa82166` | visual/ and the routes scope (`routes/sitemap-equivalence.txt`) | segments render; 0 brownlow-medal URLs; 98 `/brownlow/<season>` kept | Yes | no sitemap file changed after the routes scope (`git diff 4c2872bd..e8666c17 -- src/app/sitemap*` is empty) |
| 5 | Home record panel (ISSUE-360) | `92377e5e` | answers/fe4/ | PASS on the stated checklist | No (strict) | since then `src/components/SortableTable.tsx` and `src/components/NlAnswerFeedbackControls.tsx` changed (lint-only edits by `auth`); the panel was not re-captured on the integrated build |
| 5 | AFLW `%27` metadata and route captures | `4c2872bd` | routes/hyd-final.txt, routes/shots/ | 200, title and canonical correct, desktop and mobile | No (strict) | `src/middleware.ts` changed after the routes scope (auth SEC-2); `src/app/aflw/**` and `src/lib/params.ts` did not. Not re-measured on the integrated build (QUALIFICATION §6 says so) |

## 3. Scope READMEs' final qualifications

Scope branches are based on `5035ed96`; their runs are at the scope head, before integration. Any later change by another scope reaches the check through shared code. "Carries" below means no changed file in the
closure; for typecheck/lint/build/whole-unit checks every changed `.ts` file counts, so they never carry. The integrated runs at `3aa82166`/`6c8b02cd` (section 2) supersede all of these for the candidate.

| Scope | Check | Tested revision (code) | Evidence | Result | Changed files in inputs (`<tested>..e8666c17`, strict closure) | Carries? |
|---|---|---|---|---|---|---|
| admin | typecheck | `e0c36ce7` (code `33728416`; `e0c36ce7` only adds helper scripts) | admin/README.md Tests; host `evidence/final-tsc.log` | exit 0 | 108: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+103 more) | does not carry forward |
| admin | 7 unit suites (match-sheet, data-overrides-source-contract, admin-coach/draft-actions, v2-season-seal, player-link-mutations, awards-admin) | as above | host `final-unit.log` | 521 passed | 22: `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/db/queries/admin-coaches.ts`, `src/db/queries/grid-solver.ts` (+17 more) | does not carry forward |
| admin | int data-editor, match-admin-create, sealed-editor-guard (prep variant) | as above | host `final-int-a.log` | 93 passed / 1 skipped | 17: `src/app/admin/draft/actions.ts`, `src/db/queries/admin-awards.ts`, `src/db/queries/admin-coaches.ts`, `src/db/queries/grid-solver.ts`, `src/db/queries/nl/answer.ts` (+12 more) | does not carry forward |
| admin | int admin-coaches, admin-draft, admin-special-records, admin-audit, match-admin-delete, admin-lifecycle | as above | host `final-int-b.log` | 178 passed | 6: `src/db/queries/admin-coaches.ts`, `src/db/queries/players.ts`, `src/lib/auth/session.ts`, `src/lib/format.ts`, `src/lib/params.ts` (+1 more) | does not carry forward |
| admin | int admin-brownlow, match-results-promotion, settle-afl-api-state-b, settle-afl-api, settle-afltables | as above | host `final-int-c.log` | 251 passed / 2 failed | 8: `src/db/queries/admin-coaches.ts`, `src/db/queries/players.ts`, `src/lib/acquisition/settle-afl-api.ts`, `src/lib/format.ts`, `src/lib/home-records.ts` (+3 more) | does not carry forward |
| answers | typecheck; eslint on 8 files | `92377e5e` | answers/final/ | rc 0 | 112: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+107 more) | does not carry forward |
| answers | unit home-records, site-settings, v2-acquisition-pipeline, grid-solver-spec | `92377e5e` | answers/final/ | 100 passed / 1 failed (stage-map pin, fixed in `pins`) | 3: `src/lib/format.ts`, `src/lib/params.ts`, `tests/v2-acquisition-pipeline.test.ts` | does not carry forward |
| answers | int grid-solver, home-records | `92377e5e` | answers/green-int-*.txt | 222/222 and 7/7 | 1: `src/lib/params.ts` | does not carry forward |
| answers | int gridley-corpus before/after | `92377e5e` | answers/gridley-compare.txt | 1 failed / 1,211 passed both | none | carries forward |
| answers | FE-4 home panel visual | `92377e5e` | answers/fe4/ | PASS (stated checklist) | 2: `src/components/NlAnswerFeedbackControls.tsx`, `src/components/SortableTable.tsx` | does not carry forward |
| auth | typecheck | `b9eac839` | auth/raw/final/10-typecheck.txt | exit 0 | 112: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+107 more) | does not carry forward |
| auth | 26 unit files | `b9eac839` | auth/raw/final/20-vitest.txt | 1,143 passed | 19: `deploy/release.mjs`, `src/db/queries/admin-awards.ts`, `src/db/queries/admin-coaches.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/match-sheet.ts` (+14 more) | does not carry forward |
| auth | lint gate green/red | `b9eac839` | auth/raw/final/30-,31- | 340 allowed PASS; red probe 341 FAIL | 113: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+108 more) | does not carry forward |
| auth | SEC-1 real Caddy 2.11.4/2.11.9 before/after | `b9eac839` | auth/raw/caddy-* | tokens absent from logs | none | carries forward |
| draftguru | 13 python contracts | `a5bde875` | draftguru/ (host `final-py.log`) | all pass except gate 9.6 (no Stage A) | none | carries forward |
| draftguru | 6 vitest files | `a5bde875` | host `final-unit.log` | 445 passed / 7 skipped / 3 failed | 7: `src/db/queries/admin-draft.ts`, `src/db/queries/players.ts`, `src/lib/override-merge.ts`, `src/lib/params.ts`, `tests/data-overrides-source-contract.test.ts` (+2 more) | does not carry forward |
| draftguru | int draftguru-import | `a5bde875` | host `final-int.log` | 6 new pass / 1 skipped | 4: `src/db/queries/admin-draft.ts`, `src/db/queries/players.ts`, `src/lib/override-merge.ts`, `src/lib/params.ts` | does not carry forward |
| draftguru | typecheck | `a5bde875` | host `final-tsc.log` | rc 0 | 116: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+111 more) | does not carry forward |
| hostops | deploy-release + deploy-web-unit | `d312a5e6` (inferred: README names no final revision) | hostops/host-evidence/green-351-3-final-code.txt | 85 passed | 2: `deploy/release.mjs`, `tests/deploy-web-unit.test.ts` | does not carry forward |
| hostops | `tests/restore-test.test.sh` | `d312a5e6` (inferred) | hostops/host-evidence/ | 24/0 | none | carries forward |
| hostops | 6 neighbouring pinned suites | `d312a5e6` (inferred) | host-evidence/green-neighbours-summary.txt | 22 failed / 2,510 passed | 11: `src/db/queries/admin-draft.ts`, `src/db/queries/players.ts`, `src/lib/acquisition/settle-afl-api.ts`, `src/lib/format.ts`, `src/lib/home-records.ts` (+6 more) | does not carry forward |
| hostops | typecheck | `d312a5e6` (inferred) | README (not a committed log) | exit 0 | 118: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+113 more) | does not carry forward |
| hostops | 352 wrapper, DR A steps 3-5, units (`systemd-analyze verify`) | `d312a5e6` (inferred) | host-evidence/rehearse-352.txt, rehearse-dr.txt | as recorded | 5: `deploy/afldb-backup-verify.service`, `deploy/afldb-backup.service`, `deploy/release.mjs`, `tools/maintenance/offhost-pull.sh`, `tools/maintenance/scheduled-backup.sh` | does not carry forward |
| nl | 6 unit files | `ecc3403e` | nl/raw/unit-qual.txt | 1,050 passed | 3: `src/lib/params.ts`, `src/search/nl/parser.ts`, `tests/nl-parser.test.ts` | does not carry forward |
| nl | int nl-answers-team-club, release-gates new case | `ecc3403e` | nl/raw/int-qual-green-*.txt | green | 3: `src/lib/params.ts`, `tests/integration/leaked-fixtures.ts`, `tests/integration/release-gates.test.ts` | does not carry forward |
| nl | whole DB-free base vs fixed | `ecc3403e` | nl/raw/allunit-*-failing-ids.txt | 107 = 107 failing ids, +40 tests | 102: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+97 more) | does not carry forward |
| perf | int database, club-comparison, club-comparison-route | `b1e1a140` | perf/raw/final-qual.txt | 65 passed / 4 failed; 30 passed | 19: `src/components/SortableTable.tsx`, `src/db/queries/admin-coaches.ts`, `src/db/queries/grid-solver.ts`, `src/db/queries/match-search.ts`, `src/db/queries/match-sheet.ts` (+14 more) | does not carry forward |
| perf | unit club-comparison + view | `b1e1a140` | perf/raw/final-qual.txt | 52 passed | 4: `src/components/SortableTable.tsx`, `src/lib/format.ts`, `src/lib/params.ts`, `src/lib/sorting.ts` | does not carry forward |
| perf | one production build + HTTP load | `b1e1a140` (BUILD_ID `oUUVh6OSk_l_w_EbKJ1M9`) | perf/raw/build.txt, http-session.txt | rc 0; timings | 113: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+108 more) | does not carry forward |
| pins | db-test-rebuild, v2-acquisition-pipeline, db-promotion-check, reference-data | `4d2234bc` | host `final-focused.log` | 10 files 1,879 passed / 1 skipped (with the six py suites) | 7: `src/db/queries/admin-draft.ts`, `src/db/queries/players.ts`, `src/lib/acquisition/settle-afl-api.ts`, `src/lib/format.ts`, `src/lib/home-records.ts` (+2 more) | does not carry forward |
| pins | six python-backed suites | `4d2234bc` | host `final-focused.log` | 150 passed / 1 skipped | 5: `src/lib/format.ts`, `src/lib/params.ts`, `tools/rebuild/draftguru/README.md`, `tools/rebuild/draftguru/import_draftguru.py`, `tools/rebuild/draftguru/reload_guard.py` | does not carry forward |
| pins | whole unit gate | `4d2234bc` | pins/final-qual.txt | 7 failed / 11,899 passed | 106: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+101 more) | does not carry forward |
| pins | int nl-answers-relationships | `4d2234bc` | host `int-nl.log` | 49/49 | 4: `src/db/queries/grid-solver.ts`, `src/lib/format.ts`, `src/lib/params.ts`, `src/search/nl/plan.ts` | does not carry forward |
| rollover | 7 unit suites | `27f7b13f` (inferred: README names no revision) | rollover/README.md section 6 row 14 | all pass except the stage-map line shift | 11: `src/db/queries/admin-draft.ts`, `src/db/queries/players.ts`, `src/lib/format.ts`, `src/lib/home-records.ts`, `src/lib/override-merge.ts` (+6 more) | does not carry forward |
| rollover | int afl-api-c7-observation, 3 DB shapes | `27f7b13f` (inferred) | README section 6 row 13 | 6/6 on each | 3: `tools/v2/issue336-predraft-insert-production.ts`, `tools/v2/issue350-season-open-production.ts`, `tools/v2/season-opening-check.ts` | does not carry forward |
| rollover | plan/apply/verify/reverse on disposable clones | `27f7b13f` (inferred) | README section 6 | rows 1-13 | 2: `tools/v2/issue350-season-open-production.ts`, `tools/v2/season-opening-check.ts` | does not carry forward |
| routes | unit seo, format, coach-profile-route | `4c2872bd` | routes/green-unit-3.txt | 97 passed | 5: `src/components/SortableTable.tsx`, `src/db/queries/players.ts`, `src/lib/auth/session.ts`, `src/lib/home-records.ts`, `src/lib/sorting.ts` | does not carry forward |
| routes | int admin-awards, release-gates | `4c2872bd` | routes/int-final-admin-awards-release-gates.log | 94 / 8 failed / 7 skipped | 10: `src/db/queries/admin-awards.ts`, `src/db/queries/grid-solver.ts`, `src/db/queries/match-search.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/players.ts` (+5 more) | does not carry forward |
| routes | whole unit gate | `4c2872bd` | routes/unit-final.head | 30 failed / 11,876 passed | 105: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/clubs/compare/state.ts` (+100 more) | does not carry forward |
| routes | production build + 34,529-URL crawl + hydration | `4c2872bd` (BUILD_ID `usjtEO0IiR7zLqQnwkgzz`) | routes/hyd-final.txt, crawl summaries | rc 0; all 200 | 105: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/clubs/compare/state.ts` (+100 more) | does not carry forward |
| tests | unit beta-verify, nl-feedback, player-link-mutations | `6154732c` | tests/final-summary.txt | 257 passed | 10: `src/db/queries/admin-coaches.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/players.ts`, `src/lib/auth/session.ts` (+5 more) | does not carry forward |
| tests | int venue-records, player-matching, club-coach-records, settle-afltables, admin-season-lists, release-gates (each alone) | `6154732c` | tests/final-summary.txt | all pass except the 8 release-gates oracles | 7: `src/db/queries/match-search.ts`, `src/db/queries/match-sheet.ts`, `src/db/queries/players.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/params.ts` (+2 more) | does not carry forward |
| tests | typecheck | `6154732c` | tests/final-tsc.txt | exit 0 | 110: `src/app/admin/awards/revalidate-paths.ts`, `src/app/admin/coaches/revalidate-paths.ts`, `src/app/admin/draft/actions.ts`, `src/app/admin/draft/revalidate-paths.ts`, `src/app/aflw/clubs/[code]/page.tsx` (+105 more) | does not carry forward |

## 4. §1 broad integration run (`a119a999`): per file

Each row: the file's result in `broad-a119a999/integration.json.gz`, the changed inputs (`a119a999..e8666c17`, strict closure) and whether the isolated passes at `3aa82166` ran the same file (those results do carry).
A "file-level" status means a hook/guard error made all the file's tests report skipped.

| Integration file | a119a999 broad result (pass/fail/skip) | changed inputs | carries? | also run alone at 3aa82166 |
|---|---|---|---|---|
| `access-codes` | passed 8/0/0 | none | yes | - |
| `admin-audit` | passed 8/0/0 | none | yes | - |
| `admin-awards` | passed 43/0/0 | none | yes | - |
| `admin-brownlow` | failed 46/1/0 | `src/db/queries/admin-coaches.ts` | no | iso2-3aa82166: failed 46/1/0 |
| `admin-club-leadership` | passed 42/0/0 | none | yes | - |
| `admin-coaches` | passed 17/0/0 | `src/db/queries/admin-coaches.ts`, `tests/integration/admin-coaches.test.ts` | no | iso-3aa82166: passed 18/0/0 |
| `admin-draft` | failed 0/0/53 | none (+ named by the test file: `src/lib/auth/session.ts`, `src/search/nl/parser.ts`) | no | iso2-3aa82166: passed 53/0/0 |
| `admin-fixtures` | passed 45/0/0 | none (+ named by the test file: `src/lib/auth/session.ts`) | no | - |
| `admin-lifecycle` | passed 50/0/0 | `src/lib/auth/session.ts` | no | - |
| `admin-season-lists` | failed 0/0/42 | none | yes | iso-3aa82166: passed 42/0/0 |
| `admin-special-records` | passed 43/0/0 | `src/db/queries/admin-coaches.ts` | no | iso2-3aa82166: passed 43/0/0 |
| `admin-upload-route` | passed 3/0/0 | `src/lib/auth/session.ts` | no | - |
| `afl-api-c7-observation` | failed 3/3/0 | none | yes | iso-3aa82166: passed 6/0/0 |
| `afl-api-lineup-store` | passed 11/0/0 | none | yes | - |
| `afl-api-ownership-census` | passed 11/0/0 | none | yes | - |
| `after-siren` | passed 10/0/0 | none | yes | - |
| `auth-audit-jsonb` | passed 8/0/0 | `src/lib/auth/session.ts` | no | - |
| `awards-reload-links` | failed 96/1/10 | none | yes | iso-3aa82166: failed 97/0/10 |
| `brownlow-pending-populated` | passed 0/0/4 | none | yes | - |
| `brownlow-pending-projection` | passed 8/0/0 | none | yes | - |
| `club-coach-records` | passed 9/0/0 | none | yes | - |
| `club-comparison` | failed 42/28/0 | none | yes | iso2-3aa82166: failed 46/24/0 |
| `club-comparison-route` | failed 28/2/0 | none | yes | iso2-3aa82166: passed 30/0/0 |
| `club-comparison-view` | passed 6/0/0 | none | yes | - |
| `club-crowd-records` | passed 5/0/0 | none | yes | - |
| `club-honours` | passed 11/0/0 | none | yes | - |
| `club-match-records` | passed 5/0/0 | none | yes | - |
| `club-players` | passed 5/0/0 | none | yes | - |
| `club-premiership-players` | passed 6/0/0 | none | yes | - |
| `club-premierships` | passed 9/0/0 | none | yes | - |
| `coach-comparison-route` | passed 32/0/0 | none | yes | - |
| `coach-head-to-head` | passed 15/0/0 | none | yes | - |
| `data-editor` | failed 57/5/1 | `src/db/queries/admin-coaches.ts` | no | iso-3aa82166: passed 62/0/1 |
| `database` | failed 64/5/0 | `src/db/queries/admin-coaches.ts`, `src/search/nl/parser.ts` | no | iso2-3aa82166: failed 65/4/0 |
| `datasets` | passed 16/0/0 | none | yes | - |
| `db-health` | passed 5/0/0 | none | yes | - |
| `db-promotion-receipts` | passed 0/0/7 | none | yes | - |
| `derived-rebuild-parity` | passed 1/0/0 | none | yes | - |
| `dob-enrichment-issues` | passed 28/0/0 | none | yes | - |
| `draft-linkage` | failed 9/2/0 | none | yes | iso2-3aa82166: failed 9/2/0 |
| `draftguru-import` | passed 6/0/24 | none | yes | - |
| `email-intake` | passed 6/0/0 | `src/lib/auth/session.ts` | no | - |
| `first-kick-goal-reload-links` | passed 0/0/22 | none | yes | - |
| `fk-indexes` | passed 3/0/0 | none | yes | - |
| `grid-solver` | passed 222/0/0 | none | yes | - |
| `grid-solver-investigation` | passed 1/0/0 | none | yes | - |
| `gridley-aa-oracle` | passed 61/0/1 | none | yes | - |
| `gridley-corpus` | failed 1209/3/0 | none | yes | iso-3aa82166: failed 1211/1/0 |
| `gridley-height-oracle` | passed 61/0/1 | none | yes | - |
| `home-records` | passed 7/0/0 | none | yes | - |
| `import-role-match-lock` | passed 0/0/1 | none | yes | - |
| `import-role-parity` | passed 2/0/0 | none | yes | - |
| `isolated-populated-lifecycle` | passed 0/0/17 | none | yes | - |
| `join-request-approval` | passed 9/0/0 | `src/lib/auth/session.ts` | no | - |
| `match-admin-create` | passed 10/0/0 | `src/db/queries/admin-coaches.ts` (+ named by the test file: `src/lib/auth/session.ts`, `tests/auth.test.ts`) | no | - |
| `match-admin-delete` | passed 7/0/0 | `src/db/queries/admin-coaches.ts` | no | iso2-3aa82166: passed 7/0/0 |
| `match-results-promotion` | passed 46/0/0 | `src/db/queries/admin-coaches.ts` (+ named by the test file: `src/lib/auth/session.ts`) | no | - |
| `nl-answer-boundary` | passed 4/0/0 | `src/search/nl/parser.ts` | no | - |
| `nl-answers` | passed 33/0/0 | none | yes | - |
| `nl-answers-after-siren` | passed 20/0/0 | none | yes | - |
| `nl-answers-coaching` | passed 23/0/0 | `src/search/nl/parser.ts` | no | - |
| `nl-answers-cross-domain` | passed 22/0/0 | none | yes | - |
| `nl-answers-first-kick-goal` | passed 20/0/0 | none | yes | - |
| `nl-answers-game-season` | passed 24/0/0 | `src/search/nl/parser.ts` | no | - |
| `nl-answers-relationships` | passed 49/0/0 | none | yes | - |
| `nl-answers-team-club` | passed 36/0/0 | none | yes | - |
| `nl-search-telemetry-clear` | passed 9/0/0 | none | yes | - |
| `nl-semantic-mapping` | passed 29/0/0 | `src/search/nl/parser.ts` | no | - |
| `nl-vocab` | passed 5/0/0 | `src/search/nl/parser.ts` | no | - |
| `observation-spine` | passed 13/0/0 | none | yes | - |
| `player-compare` | passed 3/0/0 | none | yes | - |
| `player-family-and-coaching` | passed 29/0/0 | `src/search/nl/parser.ts` | no | - |
| `player-honours` | passed 3/0/0 | none | yes | - |
| `player-link-concurrency` | failed 4/4/0 | none | yes | iso2-3aa82166: passed 8/0/0 |
| `player-matching` | failed 17/6/0 | none | yes | iso2-3aa82166: passed 23/0/0 |
| `privileges` | passed 43/0/0 | none | yes | - |
| `query-builder` | passed 27/0/0 | none | yes | - |
| `release-gates` | failed 0/0/67 | none | yes | iso-3aa82166: failed 52/8/7 |
| `sealed-editor-guard` | passed 21/0/0 | `src/db/queries/admin-coaches.ts`, `src/lib/auth/session.ts`, `src/search/nl/parser.ts` | no | - |
| `settle-afl-api` | failed 54/20/0 | none (+ named by the test file: `src/db/queries/admin-coaches.ts`) | no | iso2-3aa82166: failed 73/1/0 |
| `settle-afl-api-brownlow` | passed 21/0/0 | none | yes | - |
| `settle-afl-api-brownlow-backtest` | passed 6/0/0 | none | yes | - |
| `settle-afl-api-brownlow-reschedule` | passed 3/0/0 | none | yes | - |
| `settle-afl-api-fixtures` | passed 16/0/0 | none | yes | - |
| `settle-afl-api-issue276` | failed 0/0/4 | none | yes | - |
| `settle-afl-api-state-b` | passed 1/0/0 | none | yes | - |
| `settle-afltables` | failed 3/19/63 | none | yes | iso-3aa82166: passed 85/0/0 |
| `settle-promotion-deadlock` | passed 0/0/11 | none | yes | - |
| `special-records-lifecycle` | passed 15/0/1 | none | yes | - |
| `special-records-public-suppression` | passed 23/0/0 | none (+ named by the test file: `tests/special-records-public-filter-contract.test.ts`) | no | - |
| `submission-promotion` | passed 21/0/0 | `src/lib/auth/session.ts` | no | - |
| `v2-afl-api-settle-findings` | passed 2/0/0 | none | yes | - |
| `v2-brownlow-eligibility` | passed 47/0/0 | `src/lib/auth/session.ts` | no | - |
| `v2-brownlow-eligibility-2025-rehearsal` | failed 0/0/3 | `src/lib/auth/session.ts` | no | - |
| `v2-brownlow-production-correction` | failed 0/0/8 | none | yes | - |
| `v2-coleman-publication` | failed 0/0/28 | none | yes | - |
| `v2-curated-awards` | passed 17/0/0 | none | yes | - |
| `v2-fixture-writer` | passed 29/0/0 | none | yes | - |
| `venue-records` | passed 15/0/0 | none | yes | - |

## 5. Limits and findings

- The import closure is static: dynamic requires, files read by *another* file's literals (source-contract tests that scan many files), the python tools a test spawns, and data files are not followed. Tests that scan `src/` as a
  directory (for example `tests/special-records-public-filter-contract.test.ts`, which classifies every file under `src/`) see every `src` change: for them "carries" is not claimed.
- Carry-forward of a **failing** result means only that the inputs are unchanged; it does not say the failure class (see `FAILURE-CLASSIFICATION.md`).
- The §1 revision `a119a999` is not named in any committed `qualification/broad-a119a999/` file (only on the host); the PowerShell result has no committed log; hostops, rollover and the DraftGuru Stage A counts name no revision or no JSON.
  I inferred the code commit from `git log` per scope branch (`d312a5e6`, `27f7b13f`); a final evidence-only commit follows each.
- The Stage A snapshot copy that §3 and §2 depend on was in a checkout that has since been removed (`stagea-dst.sha`: HOST-MISSING in `manifest-verify-*.tsv`); DEV's original was not read by this scope.
- No result was recomputed; carry-forward is a statement about inputs, not a test run.
