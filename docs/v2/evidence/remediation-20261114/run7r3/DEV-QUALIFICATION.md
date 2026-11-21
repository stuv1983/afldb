# Release 7R3 DEV qualification of `CAND` (21 November 2026)

**Verdict: QUALIFIED.** `CAND` = `c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76`.
- Every check that the change could affect passes.
- Every remaining failure also fails, under the same name, on the unchanged base `a3c8c67c` against the same database.

Raw summary: `DEV-QUALIFICATION-SUMMARY.txt`. It is DSN-free and ANSI-stripped.

## Setup

- **Host.** streamanator, as arm, with no sudo.
- **Workspace.** `/mnt/ssd/afldb-r7r3-20261121`.
- **`CAND`.** A clean Git checkout of the exact commit from the local bundle: `HEAD` = `c8d4202a…`, 0 porcelain lines.
  `git diff a3c8c67c CAND` = the 10 code/test paths listed in the packet §2.
- **BASE.** The 7R2-qualified `a3c8c67c` tree (`/mnt/ssd/afldb-rel7r2-20261121/cand`, an archive extract). It was re-verified here
  byte for byte: 10,129 tracked blobs, `git hash-object` equal to `git ls-tree -r a3c8c67c`, 0 differences.
- **Database.** The isolated cluster `afldb_v2_isolated` (127.0.0.1:61470). Template `afldb_v2_rb_r7r3tpl_test` is restored from
  the **accepted fully rebuilt** source-only test database. Each suite runs on its own fresh clone. No production data is used.

## Results

| Check | `CAND` | Classification |
|---|---|---|
| `npm ci`, typecheck | rc 0, rc 0 | |
| Lint gate (ratchet) | PASS, 338 in 43 files = baseline | existing debt, unchanged |
| eslint on the 10 changed files | rc 0 | |
| Unit, focused: `format`, `v2-season-seal` and 5 others | **317/317** | |
| Unit, full | 12,329 passed, **7 failed**: `draftguru-acquisition` 3 and `fitzroy-core-import` 4 | **identical 7 on BASE**, same file:line. Environment/fixture-bound, unrelated |
| `brownlow-season-attachment` (new) | **5/5** | |
| `admin-brownlow` | **47/47** | see note 1 |
| `brownlow-pending-coverage` / `-projection` / `-populated` | 8/8, 8/8, 4/4 | |
| `b1a-successor` | 14/14 | |
| `v2-brownlow-eligibility` | 47/47 | |
| `settle-afl-api-brownlow`, `-backtest`, `-reschedule` | 21/21, 6/6, 3/3 | |
| `database` `-t Brownlow`, `-t AFLDB-ISSUE-36[79]` | 10/10, 3/3 | |
| `v2-brownlow-eligibility-2025-rehearsal` | 3 failed | **identical on BASE**. Needs the dedicated pre-ruling 2025 archive clone; the accepted rebuild already carries the twelve rulings |
| `v2-brownlow-production-correction` | 5 failed, 3 passed | **identical on BASE**. Needs the dedicated `policy_final` archive clone |
| Production build | rc 0, `BUILD_ID 9C76o6Cvg6uZ7Zmz02SBM` | |
| **Changed journey on a completed-pending season** (copy state: 2026 `complete`, Gawn 2026 `pending`) | **2/2** (desktop, mobile) | "Awaiting verification" + tooltip; never "Not yet awarded" / "Results not loaded" / 0 |
| **Changed journey on a synthetic unfinished season** (2026 set `in_progress`, Gawn `pending`) | **2/2** (desktop, mobile) | "Not yet available" |
| Full `journeys.spec.ts` | 67 passed, **18 failed**, 3 skipped | **all 18 fail on BASE by title** (BASE: 21 failed, the same 18 plus its old pending-Brownlow test ×2 and one desktop coaches journey). CAND-only failures: **0**. They are dataset-bound: canonical player ids/slugs, record labels, Skilton's historical votes, the in-progress 2026 notice on a completed copy, and production-mode `robots.txt` |

## Notes

1. **`admin-brownlow`.** In the main run it was refused (`database_marker`) before any test ran. A clone of the same name left
   unmarked by the killed `9626bce1` run could not be dropped: the tool refuses to drop an unmarked database. The suite was rerun
   on a fresh marked clone (`afldb_v2_rb_r7r3_admin2_test`): 47/47.
2. **Rendering source of the changed-journey passes.** Each journey run started its own server from `CAND`'s build: Playwright's
   `webServer` is `reuseExistingServer: false` and refuses while the port is held, which is how the third run failed (note 3).
   The two passes therefore rendered `CAND` against the stated copies.
3. **DEV incident (no production contact).** The qualification harness ran `fuser -k 3100/tcp` before each journey run, assuming
   3100 was its own. On streamanator, **3100 is DEV's `afldb.service`**.
   - Three runs (16:05:43, 16:05:56 and 16:06:06 AEDT) killed it. systemd restarted it each time (`NRestarts=3`). It is now
     active, with 4 workers on its own unchanged build (`AlYJjIargpO`), health 200, no orphaned processes.
   - DEV's code, data and configuration were not changed.
   - The harness now STOPs if 3100 is held. The full-file reruns used private ports 3110 (`CAND`) and 3111 (BASE) through
     `AFLDB_E2E_BASE_URL`.
   - The 7R3 self-test uses its own port, 3371. The sitting blocks only send GETs to production's own port.
4. **Server log of the full-file rerun.** 8 × "The destination stream closed early": streamed responses that Playwright aborted
   on test teardown (BASE serving the same run logged 6). No application error.
