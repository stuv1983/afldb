# ISSUE-316 local integration candidate (2026-10-28)

**Status: INTEGRATED as three local commits on `v2/rebuild` (2026-10-28; not pushed; see §6).** R `c7e17da2…`, A
`1a6de4b6…`, F `955d0e85…` on top of `e91fae88…`; the tracking/record commit `d504932c` follows them. G was later committed
with the owner's V2-GAP-027 work in `2d0971c7`. Focused checks passed (§4.1). Proof standing: §3.

**Preparation (as first recorded).** Branch `v2/rebuild`, HEAD
`e91fae88765c5d6d74d4b2c61ee2c4d599fe5d26` (A). Native edits plus read-only Git only. Nothing was staged or committed.
There was no host, EXEC, database, rebuild, deployment, deactivation or cleanup. EXEC stays at `75df67db…` and was not accessed.
Production NO-GO. ISSUE-327 parked; Brownlow untouched. Frozen P/H material, authorities, simulation objects and evidence are unchanged.

## 1. Sources

| Set | Source (read-only) | Binding |
|---|---|---|
| R rollover | `dp-proposal-20261025/simulations/bundle-repo.git`, commit `06e88227…` (`proposed-B`) blobs | tree `a8ce0f34…` = EXEC E1; sha256s = apply-B C1 finals and the two manifest pins |
| A activation | same bundle, commit `75df67db…` (`proposed-C`) blob of `tools/db/rebuild-test.ts` | blob `11308f06…`, sha256 `ab734947…` = activate-C V3/V7 |
| F follow-up | `dp-proposal-20261025/restatements/state-C/` | every file's sha256 = `RESTATEMENT-MAP.json` `C_sha256_lf`, and P preimage = `P_sha256_lf` |

HEAD equals P (`def67651…`) on all 26 target paths, and the working tree equalled P on 23 of them. Between P and HEAD
there are only H/D-P documents and ISSUE-328 (`src/db/queries/settle-runs.ts`, `tests/admin-current-season-settle.test.ts`).
Neither touches a target path.

## 2. Changed files and hunks

**R — rollover (8 paths; whole files, byte-equal to `06e88227…`).**
- M `data/reference/afltables-network.json` (`04e2a269…`)
- M `data/reference/fitzroy-accepted-baselines.json` (`0d4f7b30…`)
- M `data/reference/seasons.json` (`1368e9b1…`): 2026 sealed, 2027 in progress
- M `tools/rebuild/afl_api/afl-api-contract.json` (`1453fffa…`)
- M `tools/rebuild/afltables/afltables-contract.json` (`ca4291cb…`)
- M `tools/rebuild/fitzroy/fitzroy-contract.json` (`4e98a4c9…`)
- A `docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json` (`02bbcf93…`)
- A `docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-ladder-v1.json` (`65c29907…`)

`data/reference/stat-availability.json` is a final that equals P (`e2900084…`), so it is unchanged.

**A — activation (1 path).** M `tools/db/rebuild-test.ts`, numstat `1 1`: line 1191 `SUCCESSOR_LADDER_TUPLES_JSON` `'{}'` →
the c2-2026-successor tuple (`a78d36ee…`, expected_rows 1640). sha256 `320960e4…` → `ab734947…`.

**F — approved State C restatements (16 paths; `F-restatements.patch`, +758 −204, HEAD→C exactly).**
- Verbatim (working tree was P): `docs/v2/coverage-matrix.md`, `packages/domain/src/coverage-registry.ts`,
  `tests/{afl-api-cutover,db-promotion-check,db-test-rebuild,first-kick-goal-source,fitzroy-acquisition,fitzroy-core-import,reference-data,season-rollover,v2-coverage-registry,v2-historical-manifest,v2-season-seal}.test.ts`.
- Three-way ported onto owner-modified files (base P, ours = owner working tree, theirs = State C):
  - `tests/v2-admin-operations-ui.test.ts`: 1 hunk (default sealed season `2025`→`2026`); clean.
  - `tests/v2-admin-operations.test.ts`: 4 hunks (comment; Coleman in-progress cases 2026→2027 with `in_progress_seasons`
    `[2027]`; new sealed-2026 case); clean.
  - `tests/afl-api-settle-cli-gate.test.ts`: 4 hunks. These are the `predecessorText` import, the comment, `makeProjectRoot(prefix, seasons = 'predecessor')`, and the new final describe "the tracked registry seals 2026 at all three AFL API settle CLIs". There were two textual conflicts: the import lines, and both sides appending a describe at end of file. Both were resolved by union (owner block first). The changed-line multiset owner→result equals P→C exactly.

**G — adaptation (2 hunks; `G-gap027-adaptation.patch`; inside the owner's uncommitted V2-GAP-027 tests).** Both cases
settle the 2026 fixture as the season in progress over a copy of the tracked seasons registry. After R the CLI
refuses them as sealed (`settle-afl-api.ts:393`, before the report destination at `:418`). The adaptation gives each scratch project the
explicit predecessor registry (`predecessorText('data/reference/seasons.json')`). That is the approved restatement's technique, and no assertion changes.
- `tests/afl-api-settle-cli-gate.test.ts` V2-GAP-027 `setup()`: +3.
- `tests/integration/settle-afl-api.test.ts`: import, plus the GAP-027 scratch-root seasons file (+7 −5).

The owner's other uncommitted suites were scanned: `v2-shadow-parity` replays only, `awards-reload-links` has no season state, and the operations-centre
fixture uses synthetic dates. None needs adaptation.

## 3. Validation carried forward (content unchanged)

- R and A bytes: day-D enforced dry run 43/43; apply-B A–F; activate-C V0–V7 (EXEC State C `75df67db…`, deactivation
  dry run proven).
- Successor rebuild: the accepted J2 Linux rebuild (2026-10-24, streamanator, pinned `876dadbf`: runner exit 0,
  `AFLDB-FINAL-VALIDATION PASSED: 91 checks`, all 1,640 comparable club-seasons agree; evidence 167/167, inputs 264/264)
  carries forward.
- F content: accepted State C broader 2992 pass / 7 skip / 0 fail and focused 396/0/0 (exit 0); fresh restatement review GO.
- The committed tree after R+A+F (`§5`) equals the validated State C tree plus only H/D-P documents and ISSUE-328.

Readiness, apply, activation, the recovery dry run and this integration executed no further rebuild and not the 91 SQL
checks; none was required (D/P acceptance 2026-10-25). Remaining release verification, not run: integration suites other
than the GAP-027 case against the integrated State C tree (the accepted matrix was DB-free), and Linux execution of that tree.

_Corrected 2026-10-28: this section first read "Not proven anywhere: the 91 SQL checks of the activated state, any successor
database rebuild, and integration suites against State C". That omitted the accepted J2 rebuild, which ran both._

## 4. Required focused checks (user-executed)

These cover only what changed relative to the accepted validation: the three ported files and the G adaptation, run over the
owner's current tree. They also cover the ISSUE-328 settle test, which posts year 2026.

```
npx vitest run tests/afl-api-settle-cli-gate.test.ts tests/v2-admin-operations.test.ts tests/v2-admin-operations-ui.test.ts tests/admin-current-season-settle.test.ts tests/v2-shadow-parity.test.ts
npm run typecheck
AFLDB_TEST_DATABASE_URL=<…_test DSN> npx vitest run tests/integration/settle-afl-api.test.ts -t "V2-GAP-027"
```

The third command needs the `afldb_test` target and tunnel; it proves the integration-side G hunk. Optional, and not
required by this port: the remaining 13 verbatim F suites over the owner's tree, `npx vitest run` on those paths.

### 4.1 Results (2026-10-28, Windows workstation, owner-authorised execution; all PASS, no corrections)

The checks ran over the owner's current working tree at HEAD `e91fae88…`, with the repository's installed Vitest 4.1.10 and
TypeScript. Nothing was downloaded. No source file was edited and no correction was needed. The F and G patches still
match `SHA256SUMS`.

| Check | Result |
|---|---|
| `node node_modules/vitest/vitest.mjs run` on the five focused files | **5 files, 499 passed, 0 failed** (exit 0) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **exit 0** |
| `settle-afl-api.test.ts -t "V2-GAP-027"` (via `isolated-pg run`) | **1 passed, 73 skipped, 0 failed** (exit 0) |

Database target. This was not `afldb_test`, 55432, a tunnel, DEV or PROD. The run used a disposable clone
`afldb_v2_i316gap027_20261028_test`, created by `isolated-pg create-db --template afldb_v2_rb_final_test` on the preserved isolated cluster
`D:\tmp\afldb-v2-pg16`. That cluster was started on **127.0.0.1:55433** and had been stopped beforehand. Nothing listened on
55432–55434 beforehand. The repository holds no `.env`, and the cluster has no `CREDENTIALS-EXPOSED` marker. Before any fixture write,
`isolated-pg` proved listener ownership, and a read-only probe reported:
`current_database=afldb_v2_i316gap027_20261028_test`, `current_user=session_user=afldb_owner` (not superuser),
`127.0.0.1:55433`, `cluster_name=afldb_v2_isolated`, PostgreSQL 16.14, marker `afldb-v2-isolated-test`. The suite's
guard repeated the cluster and marker check in-process (`AFLDB_V2_ISOLATED_PG=1`). Schema setup on the clone only:
`migrate.ts --target test` applied 116 and 117, which made the head 117 (the template was at 115). The suite's own committed fixtures
and cleanup ran there. Cleanup: the clone was dropped (`drop-db --acknowledge-destroy`), and the cluster was stopped with no
listener left on 55433. The template and every other retained database were only read. No credential or DSN was printed.

Not covered by these checks (remaining release verification, §3): Linux execution and the other integration suites against
State C.

## 5. Selective Git integration proposal (operator-executed; not run)

Precondition: `git diff --cached --quiet` (empty index) and HEAD `e91fae88…`.

```
# R — rollover
git add -- data/reference/afltables-network.json data/reference/fitzroy-accepted-baselines.json data/reference/seasons.json \
  tools/rebuild/afl_api/afl-api-contract.json tools/rebuild/afltables/afltables-contract.json tools/rebuild/fitzroy/fitzroy-contract.json \
  docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-ladder-v1.json
git diff --cached --name-status          # expect 6 M + 2 A, nothing else
git commit -m "ISSUE-316: apply the 2026 rollover (State B content of 06e88227)"

# A — activation, alone (reverting it is the deactivation route)
git add -- tools/db/rebuild-test.ts
git diff --cached --numstat              # expect: 1  1  tools/db/rebuild-test.ts
git commit -m "ISSUE-316: activate the c2-2026 successor tuple (State C content of 75df67db)"

# F — approved State C restatements only (owner hunks in the three shared tests stay unstaged)
git apply --cached issues/open/AFLDB-ISSUE-316-integration-20261028/F-restatements.patch
git diff --cached --stat                 # expect 16 files, 758 insertions, 204 deletions
git commit -m "ISSUE-316: restate coverage and 2026-in-progress tests for State C"
git rev-parse HEAD:tools/db/rebuild-test.ts   # expect 11308f06ca3e80621b628edf70e74390e22c8e36
```

Afterwards the remaining working-tree diff in the three shared tests and `tests/integration/settle-afl-api.test.ts` is
the owner's own work plus the G hunks. G must be committed in the same commit as the owner's V2-GAP-027 tests, because
those tests fail after R without it. The tracking files (`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `issues/open/AFLDB-ISSUE-316.md`, this folder) go
with the owner's documentation commit; they also carry unrelated uncommitted owner hunks, so stage them selectively.

Notes:
- The R and A commits are not individually test-green. That is by design (revision H commit 1/commit 2), and F restores green.
- A repository-level deactivation is a revert of A plus the B-state restatement deltas of `tests/db-test-rebuild.test.ts`
  and `tests/season-rollover.test.ts` (`restatements/state-B/`). The other 14 files are identical in B and C. That is a separate decision.
- A commit on EXEC remains forbidden; these repository commits do not touch EXEC's deactivate-authority binding.

## 6. Selective integration executed (2026-10-28; owner-authorised local Git only)

Precondition held: branch `v2/rebuild`, HEAD `e91fae88765c5d6d74d4b2c61ee2c4d599fe5d26`, empty index, and 98 status lines.
Before staging, all 8 R working files and `tools/db/rebuild-test.ts` were blob-equal to bundle `06e88227…` and `75df67db…`.
Every Git command named `D:\dev\afldbV2` explicitly. Nothing was reset, stashed, discarded or pushed.

| Commit | SHA | Content check |
|---|---|---|
| R | `c7e17da2aa75966240a950bd71ef646fb4b9cc9c` | 6 M + 2 A; every index blob equals `06e88227:<path>` |
| A | `1a6de4b62d80928dd05613e875559cc3eb29706b` | numstat `1 1 tools/db/rebuild-test.ts`; `HEAD:tools/db/rebuild-test.ts` = `11308f06ca3e80621b628edf70e74390e22c8e36` |
| F | `955d0e8579a127145a825ad177583639052bf25f` | `git apply --cached` of `F-restatements.patch` (sums OK); 16 files; all 16 blobs sha256 = `RESTATEMENT-MAP.json` `C_sha256_lf` |

Notes:
- **F line count.** The patch's own numstat is +758 −204, which is the §5 expectation. Git's re-diff of the committed result
  reports +762 −208. All of the difference is in `tests/db-test-rebuild.test.ts`: the patch gives 368/124, Git's default
  re-diff 372/128 and patience 370/126. It is diff alignment only, because the committed blob equals its State C pin.
- **Final content.** `e91fae88..955d0e85` touches exactly these 25 paths. Nine of them (R+A) equal `75df67db`, and the other 16 (F)
  equal State C. The bundle never carried the restatements.
- **Unrelated work preserved.** 76 status lines remain, which is 98 minus the 22 integrated paths. In the three shared tests the owner's
  hunks stay unstaged: `afl-api-settle-cli-gate` +277 −2 (which includes G's +3), `v2-admin-operations` +199 −1 and
  `v2-admin-operations-ui` +120 −3. G in `tests/integration/settle-afl-api.test.ts` also stays unstaged.
- **Documentation commit.** It carries the ISSUE-316 parts of `issues.md` (the table row and the entry), `IssuesIndex.md` (the
  ISSUE-316 section) and `CHANGELOG.md` (the ISSUE-316 section), plus `issues/open/AFLDB-ISSUE-316.md`, the apply and activation decision
  records, and this folder. The V2 closure count, the 13 closures, the GAP-025/GAP-027 entries and the other owner hunks stay unstaged.
- Validation was reused from §4.1 and the accepted State C evidence and was not repeated. ISSUE-316 stays Open, with production NO-GO.
