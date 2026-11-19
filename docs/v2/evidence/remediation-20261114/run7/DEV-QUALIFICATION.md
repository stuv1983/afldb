# Release 7: DEV qualification of `0a308e2a` (2026-11-19)

Fresh checks for release packet 7. They ran on streamanator in the disposable workspace `/mnt/ssd/afldb-rel7-20261119`, which has its
own tree, its own `node_modules` and its own isolated PostgreSQL 16 cluster on 127.0.0.1:55668 (stopped afterwards).

Untouched: the DEV service, the DEV database and the DEV checkout. One exception is read-only use of the DEV checkout's existing `.venv`
Python interpreter for the §2.3 re-run.

There was no production contact. Node v22.23.2. Run 2026-11-19 02:07–02:27 UTC, plus the re-runs and rehearsals listed below. Logs are in the
workspace `evidence/`.

## 1. Tested revision

- `git archive 0a308e2a046b85b376f362ec18098a3eb9a31086`, extracted.
  - Every one of the **10,110** blobs is `git hash-object`-equal to `git ls-tree -r 0a308e2a` (0 mismatches, 0 extra files).
  - Archive sha256 `ae3d021f954d354c22ceb93a3338f0a45a8d95748d6dc118674af73828900faf`.
  - Tree listing sha256 `9e784a711ef0db365ef37570f9c51bf209a083919b2d9b8f68c8fa424007e178`.
- The comparison tree for §2.3 is `git archive a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5` (the serving revision). It uses the same `node_modules`; `package-lock.json` is unchanged between the two.

## 2. Results (fresh, this packet)

| # | Check (command, in the candidate tree) | Result |
|---|---|---|
| 2.1 | `npm ci --no-audit --no-fund` | rc 0; 427 packages |
| 2.2 | **`npm run typecheck`** (`next typegen && tsc --noEmit`) | **rc 0**. This is the off-host evidence named by P3's `--typecheck-evidence` |
| 2.3 | `npm run lint:gate` | rc 0; 338 errors in 43 files = the ratchet baseline (unchanged; existing debt) |
| 2.4 | `vitest run --exclude 'tests/integration/**'` (full unit suite, 217 files) | rc 1: 207 files passed, 1 skipped, 9 failed (86 tests); 207 + 1 + 9 = 217. This record does not name the skipped file; the raw log is in the workspace `evidence/`. **All 9 failures are environmental and identical at `a2e6ea99`** (§2.5) |
| 2.5 | the 9 files again, `AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python` (psycopg 3.3.4), at the candidate **and** at `a2e6ea99` | Both trees: 7 files passed; 2 failed with 7 tests (`draftguru-acquisition` 2, `fitzroy-core-import` 4 plus the related ENOENTs). The causes are gitignored local source data absent from any Git archive (`data/sources/draftguru/person-html-20260826/sample.json`, `data/sources/afltables/fitzroy_core/full-history-20260902/*.csv`). **The failing-test lists are identical between the two revisions.** The other 79 failures in 2.4 were `ModuleNotFoundError: No module named 'psycopg'` from the host's system Python. None of these files or modules is in the delta |
| 2.6 | `vitest run tests/format.test.ts tests/b1a-successor-lib.test.ts tests/deploy-release.test.ts` | **145/145** (54 + 32 + 59) |
| 2.7 | `bash -n` on every `tools/v2/b1a-successor/sitting/*.sh` and `deploy/post-install-check.sh` | rc 0 |
| 2.8 | isolated cluster, `afldb_v2_rel7_test` migrated to 118: `vitest run tests/integration/b1a-successor.test.ts tests/integration/brownlow-pending-coverage.test.ts` | `b1a-successor` **14/14** (real PostgreSQL; paused-writer, drift and reversal cases). `brownlow-pending-coverage` **not run**: its `beforeAll` needs four club identities ("the ISSUE-155 fixture needs four club identities"), which a schema-only database lacks. Its subject (`player-derived.ts`) is not in the delta; it was qualified on both full-data bases in run 4 |
| 2.9 | **production build**: `npm run build` (`next build --webpack` + `prepare-standalone`) under `isolated-pg run` against `afldb_v2_rel7app_test` (migrated to 118, seeded §3), `AFLDB_ENV=production`, type-check on | **rc 0** (213 s); 38 static pages; BUILD_ID `dpwenxfnMfj6JI2ApgVCR` (standalone equal); `prepare-standalone` verified, no `.env` in the bundle. One build warning comes from Next's own `node_modules/next/dist/esm/server/app-render/dynamic-rendering.js` (an Edge-runtime `process.cwd` notice), not from the delta |
| 2.10 | **production server**: `NODE_ENV=production node .next/standalone/server.js` on 127.0.0.1:3367, **beta gate on**, epoch 1, a beta claim minted the same way as P10 | health `{"status":"ok","database":"ok"}`; anonymous `/players/pat-pending-990366` → **307** to `/beta?from=%2Fplayers%2Fpat-pending-990366`; `/brownlow/2026` **404**; `/seasons/2026` 200 with the no-votes text; server log 0 `error`/`unhandled` lines |
| 2.11 | **rendered BV cells**: raw HTML of `/players/dee-wording-990365`, and headless Chromium (Playwright 1.62.1) at 1280×900 and 412×915 | 2026 (`pending`, season **complete**): **"Results not loaded"**, title **"Brownlow Medal results for this season have not been loaded yet."**; 2025 (`complete`, 0): `0`, no title; 2024 (`not_collected`): "Not recorded"; 1943 (`not_applicable`): "No medal". Same on both viewports |
| 2.12 | **P10-shaped samples**: 16 admitted requests to `/players/pat-pending-990366`, each counted with the successor P10 `after` per-sample rule | **16 samples, 0 bad**; per sample `notloaded=2 pendnote=2 nomedal=0 nanote=0 interim=0 interimnote=0`. DEV only, one synthetic player; this is not the production P10 run (64 samples over four production players plus three controls, packet §7.2), which has not happened |

**Visual (2.11).**
- Desktop: the screenshot shows the 2026 row's BV cell reading "Results not loaded", with no "In progress" badge.
- Mobile (412 px): the season table scrolls horizontally, and the BV column is off-screen in the captured image. The DOM read confirms the text and title, but the image does not show the cell. This layout predates D-365-W; the label is three characters longer than "Not yet awarded".
- Mobile is therefore **VISUAL: DOM-verified, not visible in capture**.

The screenshots are in the workspace `evidence/player-990365-{desktop,mobile}.png`.

## 3. Seed (synthetic, isolated database only)

| player | season | season status | brownlow_status | votes |
|---|---|---|---|---|
| 990365 `dee-wording` | 1943 / 2024 / 2025 / 2026 | complete | not_applicable / not_collected / complete / pending | NULL / NULL / 0 / NULL |
| 990366 `pat-pending` | 2025 / 2026 | complete | complete / pending | 0 / NULL |

## 4. Block rehearsals (fresh)

- **P2 (`r7-p2-ff.sh`) on a disposable Git clone** (the bundle of `0a308e2a`, a bare "remote", a checkout at `a2e6ea99`). Every Git check ran as written; only the two `release.mjs` calls were replaced with `echo`.
  - A: `PREP` = `CAND` → `P2 RESULT PASS` with HEAD `CAND`, and the **114-path delta sha256 `d106757c…83b5` matched on Linux Git**.
  - B: re-run at `CAND` → PASS with no merge.
  - C: wrong `PREP` → `STOP unexpected remote drift`.
  - D: records-only descendant (docs + tracker) → PASS.
  - E: descendant touching `src/` → STOP at the docs/trackers rule.
  - F: start HEAD neither → STOP.
- **P1, P3b, P4, P8, S9 with stub programs** (no network, no database, no systemd action; host paths pointed at a sandbox).
  - P1: pass; STOP on `current` moved, remote drift, checkout HEAD, settle active, mixed 2026 statuses, and loaded votes.
  - P3b: pass; STOP on BUILD_EXIT≠0 and on a release id from another revision.
  - P4: pass (links current→new, previous→`a2e6ea99`); STOP on a host-gate refusal (links untouched) and on a wrong id prefix.
  - P8: pass; FAIL (exit 1) on interim wording and on a restart.
  - S9: pass; FAIL on the 503 gate message, a missing build manifest, an admin route not redirected, and a missing robots header.
  - **Two block defects were found by the first stub run and fixed before the manifest was written:**
    - P1 accepted a mixed 2026 state because an `&&` list hides a failing first test from `set -e`.
    - S9 would have failed a good `/beta`, because `curl -D -` headers end in CRLF.

    Both cases are in the final run, which used blocks byte-equal to `SHA256SUMS`.

## 5. Distinct from earlier evidence

The `next dev` rendered-cell observation of 2026-11-19 (before the D-365-W review, recorded under ISSUE-365) is **earlier evidence**. It is not
repeated here as such. 2.9–2.12 are new: a production build and a standalone production server of the exact candidate tree, with the beta
gate on. The ISSUE-366 qualification (`9fc1a526` + 21 files) and the D-365-W review checks (86/86) remain as recorded. 2.6 and 2.8 re-ran
their suites on the exact candidate.

## 6. Limitations

- **Not run on DEV:**
  - the Playwright e2e journeys (need a full-data database);
  - `release.mjs build`/`host-gate`/`promote` end to end (production-host tools, unchanged since they released `a2e6ea99`);
  - P1/P3/P3b/P4/P8 against real host state (stub-rehearsed only), and S9 against the public site.
- The seeded database has no view counts, so the build prerendered no player page. Player pages rendered on demand here.

  In production the 500 most-viewed pages are prerendered at build time from production data, which are already `pending`. P10 samples them (Pendlebury first).
- The owner's signed-in browser observation can only happen in the window.
