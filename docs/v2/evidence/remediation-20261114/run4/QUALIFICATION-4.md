# Remediation run 4 — qualification summary

Detailed records: `qualification-4/README.md` (Q″, scope `qual`) and `fixloop/README.md` (Q‴, scope `fixloop`); failure ledger
`FAILURE-LEDGER-4.{md,tsv}`. Every number below is copied from those records; nothing here was re-measured by the orchestrator except where
stated.

## Revisions

| Name | Full SHA | Meaning |
|---|---|---|
| B4 | `7cfbe186e70ca91db67da1aa4e28325ccbc32a86` | run-4 base (plan + plan review) |
| Q″ | `1f7b0d717b37e98432716d6b9170fbd45142ab63` | integrated executable revision, fully qualified (`qualification-4/`) |
| **Q‴** | **`16027092e075d9064df8a3749c4b17805c2eaaeb`** | **final executable revision**: Q″ + one stage-map doc line, one club-comparison assertion (`6eb90a3e`) and three manifest-map rows (`16027092`); the delta is requalified (`fixloop/`) and everything else is reused with the exact diff |

`git diff --name-only 1f7b0d71 16027092`: `docs/v2/architecture.md`, `tests/integration/club-comparison.test.ts`,
`docs/v2/evidence/remediation-20261114/run4/evidence/{README.md,SHA256SUMS,manifest-map.tsv}`, and the qual record itself
(`run4/qualification-4/**`). No `src/`, `tools/`, `deploy/`, package, migration or reference-data file changed after Q″.

## At Q″ (`qualification-4/README.md`)

| Check | Result |
|---|---|
| Rebuild reachability (F-011) | closure ∩ diff since `6d5388ea` = `src/db/queries/player-derived.ts` → **rebuilt at Q″**: rc 0, 587 s, FINAL VALIDATION PASSED 91 checks (90 value lines identical to run 3); inputs 8/8 verified before, after copy and after; dump sha256 `f3c7dca9…7715e5b` (host); 83-table exact counts identical to run 3; Brownlow `stat_availability` 390 rows identical; `venue_aliases` two surrogate ids swapped (set-equal) |
| Typecheck | rc 0 |
| Lint gate | PASSED, 338 errors / 43 files (= allowance; `--update` never run) |
| Unit (every hash-verified fixture) | 12,296 passed / **1 failed** (`tests/v2-acquisition-pipeline.test.ts` (e): stale stage map, fixed at Q‴) |
| Shell harnesses | `restore-test` 24/24, `sync-dev-remote` 42/42 |
| Build | `next build --webpack` rc 0, `prepare-standalone` rc 0, BUILD_ID `6dRxZQwoAUGMbjI5f11G3` |
| AFLW `%27` metadata, Caddy matrix | reused from run 2/3: the AFLW route closure (58 files) ∩ diff = 0; `deploy/` unchanged |
| Integration S-PF (snapshot × `all`) | 18 ids (15 failed / 3,518 passed), 0 per-file DBs left |
| Integration R-PF (rebuild × `all`) | 7 ids (4 failed / 3,529 passed), 0 per-file DBs left |
| Integration R-SH (rebuild × shared) | 7 ids (4 failed / 3,529 passed); residue `import_batches` 27 → 149 |
| Integration S-SH (snapshot × shared) | 18 ids (15 failed / 3,518 passed); residue `import_batches` 75 → 197, `award_winners` +1 |
| Comparisons | S-PF vs run 3: 31 gone / 3 new (363-B pins) / 15 continuing; R-PF vs B4 C1 and R-SH vs B4 C2: 66 gone / 0 new / 7 continuing; S-SH vs B4 C3: 31 / 3 / 15 |
| Dedicated clones and tools | Brownlow eligibility-2025 3/3, production-correction 8/8; OD-5 `settle-afl-api` 74/74 on rebuild-named clones of both bases; `v2-coleman-publication` 28/28 (schema-only); ISSUE-238 rehearsal tool 83/84 PASS (c47 class 6, forbidden literal port) |
| Stage A during integration | absent from the checkout in all four cells (as baseline and run 3) |

Every failing id is classified (`FAILURE-LEDGER-4.md`): class 1 ×17 per snapshot cell and ×4 per rebuild cell; class 5 ×1 (snapshot) and ×3 (rebuild);
no class 2, 3, 4 or 6.

## At Q‴ (`fixloop/README.md`)

| Check | Result |
|---|---|
| Diff Q″..Q‴ | 277 files: 272 under `run4/qualification-4/**` (records) plus `docs/v2/architecture.md` (one line), `tests/integration/club-comparison.test.ts` (+7/−2), `run4/evidence/{manifest-map.tsv,README.md,SHA256SUMS}`; 0 files under `src tools deploy packages data docs/rebuild-manifests scripts public`, package files or `next.config.ts` |
| Typecheck / lint gate | rc 0 / PASSED 338 errors in 43 files |
| Unit (every hash-verified fixture) | `tests/v2-acquisition-pipeline.test.ts` 24/24 ((e) green). Full run 1: 12,296 passed / 1 failed (`tests/rate-limit.test.ts:55`, a 1 ms-window timing test; 10/10 alone); full run 2: **12,297 passed / 0 failed** (25 skipped). The run-1 failure is a timing flake unrelated to the diff (LOW, `RESIDUALS-4.md` §2.5) |
| `club-comparison` whole file | 70/70 on the Q″ rebuild and the 4 Nov snapshot, per-file and shared (4 runs) |
| F-FX-1 mutations (2026 Brownlow loaded) | club-attributed `mreal`: 70/70 whole file on both bases. The club-less `mnew`: the targeted test passes on both bases (it failed at Q″), but the whole file fails 1 test at `:1800`, the unchanged multi-club invariant, because a club-less 2026 vote row for a player with no 2026 season row is itself inconsistent data. **Orchestrator decision: `mreal` is the acceptance mutation** (`mnew` does not model a loaded season; the `:1800` refusal is correct behaviour) |
| Reused from Q″ with the exact diff | the four integration cells (every file except `club-comparison`), clones and rehearsal tool, shell harnesses, build, rebuild reachability (rebuild closure 57 files and AFLW closure 58 files ∩ diff = 0; `docs/v2/architecture.md` is imported by nothing in `src/`, `next.config.ts` or `package.json`) |


## Manifest verification

Fresh clone of `ba77ae3b` (the fix-loop record on top of Q‴; scope `fixloop` F6), `REQUIRE_NO_UNRESOLVED=1`: **rc 0**: 70 manifests, 5,718 entries: COMMITTED-OK 3,752, COMMITTED-OK-ALIAS 15, COMMITTED-MISMATCH 0, AMBIGUOUS 0, HOST-OK 1,855, HOST-MISMATCH 0, HOST-MISSING 0, DECLARED-NOT-RETAINED 96, **UNRESOLVED 0**. At Q″ + qual record the same gate reported UNRESOLVED 11 (three run-4 host-only manifests without a declared host root); the map rows added at Q‴ resolve them (`run4/evidence/README.md` §8). The pre-final tip and the tagged candidate are re-verified by `afldb-closure` (`CLOSURE-4.md`, phase A; phase B outside the candidate). The original run-2 script still reports its known false positive (`run2/evidence/ERRATA.md`).
