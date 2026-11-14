# Remediation run 2026-11-14 — integrated qualification

Candidate: branch `claude/remediation-20261114` (base `5035ed96`, on `origin/main` `de640826`). **Local, not published, not
deployed.** Every run below was on streamanator in a fresh disposable workspace (`/mnt/ssd/afldb-rem-int-20261114`), against an
isolated PostgreSQL 16 cluster (port 55630) restored from the 2026-11-04 production snapshot
(`afldb_prod-20261104T021037Z.dump`, sha256 `e77c307d…826d`; ledger 118, 17,056 matches). No production or DEV database was
written. Raw results stay on the host under `evidence/` and are copied in compact form to `qualification/` beside this file: logs with DSN lines removed, raw vitest/eslint JSON reports gzipped with DSNs masked, screenshots, and `SHA256SUMS`. (`cmp-integ-*` are the superseded per-test comparison; `cmp2-integ-*` count file-level errors.)

**Automated verdicts and manual assessments are kept apart.** A test is "PASS" only when the runner says so; anything
classified by reading a log is labelled **classified**, and no failure is relabelled a pass.

## 1. Broad run at `a119a999` (all scopes integrated plus the integration fixes)

| Check | Automated result | Baseline (review, `de640826`) |
|---|---|---|
| Typecheck (`tsc --noEmit` after `next typegen`) | **PASS** rc 0 | PASS |
| Lint (`eslint .`) | 338 errors / 146 warnings (`src` 11, `tests` 276, `tools` 39, `.phaneslight` 12) | 607 errors / 149 warnings |
| Lint gate (`npm run lint:gate`, baseline 338) | **PASS** | no gate |
| Unit (`vitest run`, Linux) | 8 failed / **12,108 passed** / 31 skipped | 107 failed / 11,739 passed |
| `tests/restore-test.test.sh` | **PASS** 24/0 | — |
| `tests/sync-dev-remote.test.sh` (with the generated payloads exported by `sync-dev-static.test.ps1`) | **PASS** 86/0 | 42/0 (payload cases not run) |
| PowerShell tests (Windows PowerShell 5.1, workstation) | **PASS** 4/4 | 4/4 |
| Integration (`vitest run tests/integration`, one shared copy, full parallel) | 99 failed / **3,160 passed** / 2 expected-fail / 345 skipped (3,629) | 99 failed / 3,046 passed |
| Production build (`next build --webpack`) | **FAIL**: `next/font` Google loader `TypeError: Cannot read properties of null (reading '1')` | PASS |

### Unit failures (8) — classified

- 3 `tests/draftguru-acquisition.test.ts`, 4 `tests/fitzroy-core-import.test.ts`: **environment.** The gitignored DraftGuru
  Stage A snapshot and the retained fitzRoy core snapshots are not in a fresh checkout (`snapshot directory not found`). Six of
  the seven failed the same way at baseline; the seventh (bridge import gate) is a new test path reaching the same missing
  directory. The DraftGuru cases were re-run against a read-only copy of DEV's snapshot (§3). No fitzRoy snapshot exists on the
  host, so those four are **not run** (gap).
- 1 `tests/special-records-public-filter-contract.test.ts`: **real**, introduced by the ISSUE-353 change (a new
  `src/db/queries/match-sheet.ts` read of a special-record table was not classified). Fixed in `fb6ac276` (classified
  non-public); green in the delta run (§2).

**102 baseline unit failures now pass:** after-siren 30, db-test-rebuild 21, brownlow-season-artefact 15, sibling 12,
father-son 11, height 10, coach 1, db-promotion-check 1, v2-acquisition-pipeline 1 (ISSUE-358 pins, ISSUE-363 interpreter
resolution).

### Integration failures (99) — classified

`qualification/broad-a119a999/cmp2-integ-*.txt` compares failing test ids with the review baseline
(`/mnt/ssd/afldb-review-20261114T0640Z/evidence/integration.json`), **counting file-level (hook) errors**, which make vitest
report every test of the file as skipped: **92 common, 15 new (13 tests + 2 file-level errors), 13 absent from the failures,
of which only 3 genuinely pass.**

> **Correction (orchestrator, during this qualification).** A first comparison counted only per-test failures and reported
> "13 now passing". Ten of those were not passes: `release-gates` (9) and `admin-season-lists` (1) did not run at all in the
> full run, because the new leak guard (ISSUE-363 TST-9) threw in their `beforeAll` on the leaked season 2076 and vitest
> reported their 67 + 42 tests as skipped under a failed file. The guard behaved as designed (fail fast, naming the owner);
> the comparison script was wrong and was corrected (`orch-cmp.mjs` v2). `admin-draft` (53 tests, including the ISSUE-354
> draft cases) was skipped by its own setup hook in **both** runs for the same leak class: it derives an empty draft year from
> `max(matches.season)`, which a leaked fixture season pushes past every club identity. All three files were re-run alone (§3, §4).

- **Genuinely passing now (3):** nl-answers-relationships 2 (oracle derived from the source CSV, ISSUE-358), derived-rebuild-parity 1.
- **Absent because their file did not run (10):** release-gates 9, admin-season-lists 1. Alone on a fresh copy (§3):
  release-gates still fails **8** of the 9 (the baseline snapshot-oracle cases: 2026 `complete` vs pinned `in_progress`,
  261 vs 268 players, 183 Brownlow careers outside coverage, 110 vs 18 undated players, Western Bulldogs identity range,
  attendance reasons) and the ninth (birth dates by profile URL) passes; admin-season-lists passes in full.
- **Common (92):** as characterised at baseline (review §5): load/hook timeouts, snapshot-pinned oracles (the 2026-11-04
  production snapshot is not the rebuilt `afldb_test` those suites pin), performance ceilings under shared load, and the
  baseline's own file-level errors (admin-draft, settle-afl-api-issue276, two dedicated-clone Brownlow files,
  v2-coleman-publication, settle-afltables hook timeout). Re-run alone on fresh copies in §4.
- **New file-level errors (2):** release-gates and admin-season-lists, above.
- **New test failures (13), each re-run alone on a fresh copy (§3):**
  - `settle-afltables` ISSUE-295 ×2 and `awards-reload-links` Under 22 ×1: hook/test timeouts under full-suite load.
  - `afl-api-c7-observation` ×3 (the new ISSUE-350 season-opening cases): `expected [2026, 2027] to include 2076`.
    **Cause:** `settle-afltables` timed out under load, its `afterAll` cleanup timed out too, and its fixture season (2076
    since the ISSUE-363 TST-9 move from 2094) leaked into the shared database. The new leak guard names it. This is the
    shared-database fixture-leak class that ISSUE-363 stays open for.
  - `data-editor` 2a/2b/2c/3a/3b ×5: the snapshot holds one active `player_match_stats` override; these cases need an
    authority-free database. At baseline they were **skipped** (`canReplay` false: the host `python3` lacked `psycopg`); the ISSUE-363 interpreter resolution makes them run, and they then refuse on the snapshot row (`expected 1 to be +0`). Green with the admin scope's
    `prep-authority.mjs` on a fresh copy (§3).
  - `gridley-corpus` ×2: timing (`clubs1` over 1 s; deferral-policy cells) under shared load.

### Build failure — classified

`next/font/google` failed while downloading font metadata during the shared-load run; Google Fonts answered 200 from the host
afterwards. Classified **transient network**, not a code defect; retried in §3: **PASS**.

## 2. Delta runs after the review fixes

| Revision | What changed | Result |
|---|---|---|
| `e905915a` (review A fixes) | admin-coaches, scheduled-backup, offhost-pull, units, issue350 lock, season-opening-check default | tsc rc 0; focused unit 1,900 passed / 1 failed. The failure was the new off-host pull test's own helper counting `.verified-*` markers as dumps; fixed in `3aa82166`. |
| `3aa82166` | test helper; special-records contract | tsc rc 0; `tests/deploy-web-unit.test.ts` + `tests/special-records-public-filter-contract.test.ts` **50/50 PASS**; tree clean |
| `48286d7a` (review B fixes) | admin mint epoch; NL minimum-one / participation noun | covered by the final unit run below (auth, nl-parser) and the §3 parse-only corpus |
| **`6c8b02cd` (final code state; later commits are documents and evidence only)** | — | typecheck **PASS** rc 0; lint gate **PASS** (338 errors; baseline allows 338); unit (216 non-integration files) **12,125 passed / 6 failed / 25 skipped**. The 6: 4 fitzRoy core import (no retained snapshot) and 2 DraftGuru frozen B1 sample (no `person-html-20260826/sample.json`): **environment, not run**. This run's command omitted the broad run's `--exclude 'tests/integration/**'`, so the 98 integration files were also collected and failed at setup for want of a database, executing nothing; the counts above are the non-integration files only, split from `final-6c8b02cd/unit.json.gz`. The workspace now held the read-only DEV Stage A copy, so the DraftGuru bridge-gate case ran and passed (the broad run's 8 → 6). Tree clean before and after. |

## 3. Isolated pass at `3aa82166` (`qualification/iso-3aa82166/`)

Each suite alone on a fresh copy of the snapshot template, serially, under the run-wide heavy lock.

| Suite(s) | Automated result | Classification |
|---|---|---|
| `settle-afltables` | **PASS** 85/85 | The 2 new ISSUE-295 failures and the 17 baseline failures of the full run are load/hook timeouts; nothing leaks when it runs alone. |
| `afl-api-c7-observation` (incl. the new ISSUE-350 season-opening cases) | **PASS** 6/6 | The 3 full-run failures were caused by the leaked 2076 season. |
| `awards-reload-links` | 97 passed / 10 skipped; 2 describe-level errors | The Under 22 case passes alone (full-run failure was a timeout). The 2 errors are the baseline's Coleman oracle: the snapshot holds 47 Coleman winner rows, the tracked contract 46 (`data/reference/coleman-derivation.json`); environment (snapshot ≠ rebuilt `afldb_test`). |
| `data-editor` (with `prep-authority.mjs`: retires the snapshot's one active `player_match_stats` override on the copy) | **PASS** 62 passed / 1 skipped | The 5 new full-run failures need a database with no active `player_match_stats` authority (they were skipped at baseline for want of `psycopg`); environment of the snapshot, not a defect. |
| `admin-coaches` (incl. the review A-01 manual-coach case) | **PASS** 18/18 | |
| `gridley-corpus` | 1,211 passed / 1 failed | The 2 timing failures pass alone. The remaining failure ("no failing cells") is the baseline's accepted Gridley limitation. |
| `release-gates` + `admin-season-lists` | 94 passed / 8 failed / 7 skipped (`it.skip` in source) | `admin-season-lists` passes in full. The 8 `release-gates` failures are the baseline snapshot oracles listed in §1. |
| Production build (`next build --webpack`, then `prepare-standalone`) | **PASS**; BUILD_ID `GciqAlQ-EN8HR4V6tU-aP`; tree clean after the build | The §1 `next/font` failure was transient. |
| Parse-only V5 corpus (12,000 questions) vs the nl scope's fixed run | **12,000 pass / 0 soft-fail / 0 fail**, `PARSER_VERSION` 68; **0 questions changed** (`corpus-diff-parse.jsonl` empty) | Includes the review B-02 parser change. |
| DraftGuru Stage A (read-only copy of DEV's `annual-html-20260826`, sha256 manifest identical to the source) | vitest 215 passed / 2 failed / 1 skipped; all 13 `tests/python/draftguru_*_contract.py` exit 0 | The bridge import gate case passes with the snapshot. The 2 failures need the frozen person-level sample `person-html-20260826/sample.json`, which exists neither in a fresh checkout nor on DEV: **not run (environment)**. |

## 4. Second isolated pass: baseline-common suites at `3aa82166` (`qualification/iso2-3aa82166/`)

The suites that also failed at baseline, plus the admin suites the full run could not exercise, each alone on a fresh copy.

| Suite(s) | Automated result | Classification |
|---|---|---|
| `club-comparison` + `club-comparison-route` | 76 passed / 24 failed | Every failure is a fixed-number witness pinned to an older data state (Adelaide v Brisbane Lions 43 vs pinned 41 meetings; Carlton v Collingwood 270 vs 268; crossover 12 vs 11; …). The 24 are a strict subset of the 30 full-run (baseline-common) failures; the other 6 were load. **No failure involves the ISSUE-361 compare gate.** |
| `settle-afl-api` | 73 passed / 1 failed | The baseline's rebuild-target-name refusal (`Refusing to rebuild …`: rebuild targets are name-pinned). The full run's 20 failures were load. |
| `player-matching` + `player-link-concurrency` | **PASS** 31/31 | The 10 full-run failures were load. |
| `admin-draft` + `admin-special-records` + `match-admin-delete` | **PASS** 103/103 | `admin-draft` (including the ISSUE-354 draft cases) runs alone; in both full runs its setup hook skipped it (leaked fixture season, §1). |
| `database` + `draft-linkage` + `admin-brownlow` | 120 passed / 7 failed | Baseline snapshot oracles: player-match dataset size and 3 Advanced Search counts (`database`), DraftGuru production links (`draft-linkage` ×2), and `admin-brownlow` P2 (the snapshot's 9,522 round rows with NULL `match_id`; review A-05). |

**Net:** run alone, every failure of the candidate is either a baseline snapshot oracle, the accepted Gridley limitation, or
a named environment refusal. No failure is attributable to a remediation change.

## 5. Visual evidence

Production build `GciqAlQ-EN8HR4V6tU-aP` (candidate `3aa82166`) served on loopback against a snapshot copy, Playwright
(the repository's own install), consent declined. Declared before capture: viewports desktop 1280×800 and mobile 390×844;
screens S1 `/match-search` form, S2/S2b Richmond–Carlton with `club_match=both|any`, S3 a qualifying-matches drill-down from a
real NL answer, capped and uncapped. Images and `report-v2.json`/`report-v3.json`: `qualification/visual/`. The first capture (v1) used
viewport-only screenshots, so S2 and S2b were byte-identical and proved nothing; it was discarded and recaptured (v2/v3).

| Check | Desktop | Mobile | Verdict |
|---|---|---|---|
| S1 "Two clubs" select visible, labelled, options "Games involving either club" / "Games between the two clubs", no page overflow | yes | yes | **PASS** |
| S2 `both`: "231 matches · Clubs (head-to-head): Richmond v Carlton"; every visible row is Richmond v Carlton; select shows "between" | yes | yes | **PASS** |
| S2b `any`: "4,879 matches · Clubs (either): Richmond or Carlton"; rows include other fixtures | yes | yes | **PASS** |
| S3 capped ("teams with more than 3 wins", first club): "Most recent qualifying games", "1,641 total", 500 rows newest first, note "Showing the 500 most recent of 1,641 qualifying games." | yes | yes | **PASS** |
| S3 uncapped control ("…against the Lions"): 27 rows, no note | yes | yes | **PASS** |

The results table scrolls inside its own container on both viewports (the existing table pattern); the page never overflows.
The home record panel (ISSUE-360) was captured by the answers scope (`answers/fe4/`). The route and AFLW captures are the
routes scope's (`routes/shots/`, `routes/hyd-final.txt`).

**Sitemap (ISSUE-360/364) on the integrated build, `AFLDB_INDEXING=on` at runtime:** `/sitemap.xml` and `/sitemap-index.xml`
are byte-identical (the index was prerendered at build time with indexing off, so both serve the handler's own `Not found`;
the plain-text body proves the rewrite reaches the handler). Segments render at runtime: 10 segments, about 34,500 URLs,
**0** `/awards/brownlow-medal…` redirect URLs, 98 `/brownlow/<season>` pages kept. The index body itself was proven with indexing
on by the routes scope (`routes/sitemap-equivalence.txt`: index byte-identical before and after; segment 1 lost only the
brownlow-medal lines). No sitemap code changed after that scope.

## 6. Gaps (not run or not proven)

- fitzRoy core import unit cases (4): no retained snapshot on the host; a full `afldb_test` rebuild is blocked for the same reason.
- A full integration run against a rebuilt `afldb_test` (the oracle many suites pin) was not possible; the production snapshot
  was used and the snapshot-oracle failures are classified, not passed.
- Host-policy files (needrestart, apt) were syntax-checked only; the backup and notifier units were checked with
  `systemd-analyze verify` but never ran under systemd on production. Nothing was installed.
- Production-host facts unreadable to `arm` (root crontab, sudoers, production `.env` beyond the epoch, journal) are not claimed.
- AFLW `%27` metadata: review B called it unverified on a production build. It was measured on the routes scope's served
  production build `usjtEO0IiR7zLqQnwkgzz` (`routes/hyd-final.txt`: `/aflw/players/Aasta_O%2527Connor` 200, title
  "Aasta O'Connor — AFLW Stats, Games & Career Record | AFLDB", canonical kept encoded, desktop and mobile). It was **not
  re-measured on the integrated build**; the AFLW code is unchanged since that scope's head.
