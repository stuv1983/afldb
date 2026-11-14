# Remediation run 2, scope `lint364`: ISSUE-364 lint ratchet gate wiring, B-07, A-09

Branch `claude/rem2-lint364-20261114` from `e8666c17`. Local only; nothing pushed, merged, deployed or installed.
Code commits: `ce47bfa8` (gate wiring, B-07, docs, tests) and `81afe1bb` (A-09 wrapper, tests). This README and its raw
files are a records-only commit on top (`git diff --stat 81afe1bb..<tip>` lists only `docs/v2/evidence/remediation-20261114/run2/lint364/`).
**The qualified executable revision is `81afe1bb`.**

## 1. What the gate is (wording used everywhere)

`npm run lint:gate` is a **ratchet against 338 existing errors in 43 files** (`tools/dev/lint-baseline.json`), **not clean lint**.
It counts error-severity messages per (file, rule). A pair above its baseline, or absent from it (a new file, or a new rule in
an old file), fails. `tools/dev/lint-baseline.json` is untouched: `git diff e8666c17..HEAD -- tools/dev/lint-baseline.json`
is empty (`final-run.txt`), and a new test (`the committed baseline is a ceiling`) fails if the committed file ever holds
more than 338 errors or 43 files.

## 2. Task 1: wiring, and the run-versus-record decision

| Entry point | Runs the gate |
|---|---|
| `npm run preflight -- --mode implementation` | yes |
| `npm run preflight -- --mode merge` | yes |
| `npm run merge:ready` | yes |
| `--mode read-only`, `rebuild`, `promotion`, `deploy` | no (`LINT_GATE_MODES = ['implementation','merge']`, tested) |
| `deploy/release.mjs`, `deploy/sync-dev.ps1` | no (not touched) |
| `docs/development/WORKFLOW.md` | one paragraph after the lifecycle; the doc lists no separate "qualification step" |

**Decision: the entry points run the gate themselves; they do not check a recorded result.** Reasons: (a) there is no existing
record store in preflight or `merge:ready` that is bound to the tree it describes; the only recorded thing is the free-text
`validation` array in the runbook's readiness block, which is not machine-checked and goes stale on the next edit, so a
"recorded pass" could not refuse an increase; (b) ESLint is read-only and deterministic, so running it does not break the
"read-only, no fetch/migrate/write" contract (the usage and header text now say the gate runs); (c) cost: measured on the
busy shared host, `eslint .` alone 109 s and `npm run lint:gate` 110-111 s (user 2m53s). That is acceptable for the two
moments it guards (start of an implementation, last look before a merge); it is not acceptable for every preflight mode, which
is why the other modes skip it. There is deliberately **no `--skip-lint` flag**: a skip switch is a way to defeat the gate.
Residual: two to three minutes added to those commands (see 6).

Refusals (all non-zero, named; the standalone command returns exit 2, the operator reports mark the check FAIL so
preflight prints `BLOCKED` / merge:ready prints `BLOCKED` and exit 1):
increase in any pair; new file with errors; new rule in an old file; baseline missing; baseline malformed (not JSON, not an
object, a non-object rule map, a negative or fractional count); ESLint not installed; ESLint cannot be started (B-07);
ESLint ended with an exit other than 0 or 1 (config error, signal); ESLint printed no JSON; JSON was not a list.

## 3. Task 2: tests and red/green (all in existing suites)

`tests/workflow-preflight.test.ts` (extended; it already holds the merge-readiness and lint-gate tests):
- merge:ready through a **real** `runMergeReadiness` against fixture repositories carrying a fake `eslint.js` and baseline
  (the real gate code runs; only ESLint's output is controlled): READY with the ratchet wording; rise refused; new rule and
  new file refused; decrease passes with a WARN; baseline missing refused; five malformed-baseline shapes refused; ESLint
  not installed refused; ESLint printing no JSON refused.
- preflight: `lintGateStep` runs only for implementation and merge; regression, refusal and a throwing gate are all FAIL with
  the reason; a source-structure test that `preflight.ts` feeds every finding into the report that decides BLOCKED
  (the main body is not importable, so it is structural, plus the real run in 4).
- gate: B-07 spawn failure; abnormal ESLint exit, signal, non-list JSON; unspawnable ESLint through `evaluateLintGate`;
  CLI exit 2 for missing and malformed baselines; committed-baseline ceiling.
- The child_process mock gained a `nodeOverride` hook (same pattern as the existing `gitOverride`).

`tests/deploy-release.test.ts` (A-09, see 5).

**Red on the unfixed code** (`red-all.txt`, sha256 `5c0d7228e00128e2356357be7b4a2576ca78195b1ac9ff809153c15d2e0a1245`; then
`red-final.txt`, `318c640d2b0beced3b617afb7f2c9d77efd6237873b83109c3ddcf4a6f08f9a7`, the final tests against the base
`lint-gate.ts`/wrapper/preflight files):
`B-07: a failed ESLint spawn is a named refusal (exit 2), not a TypeError` fails with the exact text
**`TypeError: results is not iterable`** at `summariseErrors tools/dev/lint-gate.ts:29:22` called from `runLintGate :94:19`.
Other reds: `expected +0 to be 1` (merge:ready did not run the gate), `expected +0 to be 2` (CLI with a malformed baseline),
`evaluateLintGate is not a function`, and the wrapper assertions in 5. The first red run had 27 failures; the final
selected run on base code had 12 failures, 2 passes, 101 skipped.

**Green on a clean checkout of `81afe1bb`** (`final-run.txt`, sha256 `b1696d4449ed1e971f5c42fe2c67b12f424c4f2aaaea42391445bf030475c806`):
`HEAD=81afe1bbe96448f19125f3d12b4c862a7dbf1d9b`, `git status --porcelain` empty before and after `npm ci` and at the end;
`npx vitest run tests/workflow-preflight.test.ts tests/deploy-release.test.ts tests/afl-api-ingestion-safety.test.ts`:
3 files, **306 tests passed**; `npm run typecheck` exit 0; `npm run lint:gate` exit 0
(`338 error(s) in 43 file(s) now; the ratchet baseline allows 338 in 43`, 111 s).

Ratchet decrease: **kept as it was** (passes, reported). It is not wrong for the contract (every pair is gated separately, so
slack in one pair cannot hide a rise in another), but it has the known weakness that slack can be spent again until someone
runs `--update`. Forcing a tighten would make every unrelated merge depend on ESLint output being byte-identical across
checkouts and platforms, and would block a fixer who deleted a file. Now: a decrease yields a `WARN lint baseline has N
paid-down pair(s) not yet tightened` in preflight and merge:ready (tested), and the weakness is stated in the module header and
in section 6.

## 4. Real runs (clean clone, `final-run.txt`; negative, `negative-run.txt` sha256 `7a49104039dd86feee81000d56670c1df42c9e29a73d3618a833606929b928ee`)

- `preflight --mode implementation` in the final clone prints `PASS lint ratchet gate: no error count rose` with the ratchet
  figures; the result is BLOCKED only for the two clone-specific Git reasons (not a linked worktree, no local `main`), exit 1.
- Negative: in a second clone one baseline count was lowered by 1 (so the tree exceeds it). `npm run lint:gate` exits **1**:
  `REGRESSION: .phaneslight/scripts/api-diff.js: @typescript-eslint/no-require-imports 1 -> 2`; preflight prints
  `FAIL lint ratchet gate: error count rose or a new file has errors` and exits 1. (The negative clone is a throwaway copy; the
  candidate baseline was not modified.)

## 5. Task 4 / A-09: drift versus a check that failed to run

Finding validated: `deploy/afldb-settle-afl-api.sh` printed `AFLDB_NODE_MODULES_DRIFT` for any non-zero exit.

**Exit-code contract (reported, `deploy/release.mjs` NOT edited):** `release.mjs:1533` documents `exit 0 ok/unknown, 1 mismatch`,
but a refusal or crash also leaves `process.exitCode = 1` (`release.mjs:1741-1743`) and only a usage error is 2, so **the exit
code alone cannot separate drift from a failed check**. The documentation is therefore insufficient for the A-09 purpose
rather than absent. I did not edit the file as instructed; I instead use the check's own stdout verdict line, which only the
mismatch path prints (`release.mjs:1538`, `log('NODE_MODULES MISMATCH')` -> `release: NODE_MODULES MISMATCH`, immediately before
`return 1`). **Orchestrator decision (optional):** give drift a dedicated exit code (for example 3) in `release.mjs` and
key the wrapper on it; the present change does not need it and the existing test (`check-node-modules exits 1 on drift`) pins 1.

Wrapper now: `AFLDB_NODE_MODULES_DRIFT` only when non-zero **and** the verdict line is present; any other non-zero outcome
(exit 1 from a crash, 2 usage, 130 interrupt, 127 Node not executable) logs
`AFLDB_NODE_MODULES_CHECK_FAILED: the node_modules check did not reach a verdict (exit N); node_modules is NOT verified; the run
continues (ISSUE-364)`. Still warn-only; the settle always reaches the season step. The check's stdout is re-printed to
stdout (as before); stderr is untouched.
Tests (`tests/deploy-release.test.ts`, Linux-only like the existing one, run on the host): the real wrapper block is
extracted and run under `set -eu`: real drift (real `release.mjs` copied into the fixture; a symlink would defeat its
`argv[1]` main guard), matching and unrecorded trees (no marker), a failing check at exit 1/2/130, an unexecutable Node
(127), and a failure that only mentions the drift wording. Red on the base wrapper: five of those fail
(`expected 'release: ERROR: boom\nAFLDB_NODE_MODU…' to contain 'AFLDB_NODE_MODULES_CHECK_FAILED: the …'`, etc.). The old structural
assertion (`|| echo "AFLDB_NODE_MODULES_DRIFT`) was updated to the new structure (`|| nm_status=$?`), not weakened: it still
requires the check to be placed after `AFLDB_SKIP_DOTENV` and before the first `tsx` invocation.

## 6. Residuals (consequence / existing protection / operator action / alternatives / recommendation)

1. **Ratchet slack** (above). Consequence: paid-down errors can be re-spent until the baseline is tightened. Protection: WARN in
   preflight/merge:ready; the ceiling test. Operator action: tighten with `npm run lint:gate -- --update` in a reviewed commit
   that only lowers counts. Alternative: make a stale baseline a FAIL (rejected, above). Recommendation: keep; tighten whenever
   errors are fixed.
2. **Gate not in `release.mjs`/`sync-dev.ps1`/CI** (by P2-09). Consequence: a release or DEV deploy does not itself run lint; it
   is enforced at preflight/merge:ready. Operator action: run `merge:ready` before the merge (it is already in the lifecycle).
3. **Runtime**: about two minutes added to `preflight --mode implementation`, `--mode merge` and `merge:ready`.
4. **`.phaneslight/scripts/*.js` errors** are part of the 338 (CommonJS `require` in four tool scripts); the baseline records them,
   nothing was silenced or changed.
5. **A-09 relies on a stdout line** until `release.mjs` gets a dedicated exit code (section 5).
6. **11 `src` errors remain** (`react-hooks/set-state-in-effect`); fixing them is out of scope here (baseline must not move).

## 7. Operator procedure text for the orchestrator (owner running the gate before a merge)

1. In the issue worktree, after the reviewed local commit: `npm run merge:ready -- --issue NNN`. It now includes the lint
   ratchet gate (about two minutes). `READY` means no file's error count rose and no new file has errors.
2. To see the same verdict alone: `npm run lint:gate` (exit 0 pass, 1 regression, 2 refused with a named reason).
3. A regression: fix the new errors; never raise `tools/dev/lint-baseline.json`. A refusal: `npm ci` (ESLint missing) or restore
   the baseline from Git.
4. After paying errors down: `npm run lint:gate -- --update`, review that `git diff tools/dev/lint-baseline.json` only lowers
   counts or removes keys, commit it.
5. `npm run preflight -- --mode merge` from clean main runs the same gate.

## 8. Proposed ledger text, ISSUE-364 (local, qualified, not published)

**Status:** Open until O-2 is owner-approved for publication (the gate is wired locally).
**Fix (run 2, `claude/rem2-lint364-20261114`, `ce47bfa8`, `81afe1bb`):** `npm run lint:gate`, a ratchet against the 338 existing
errors in 43 files (`tools/dev/lint-baseline.json`, unchanged; not clean lint), runs inside `preflight --mode implementation`,
`preflight --mode merge` and `merge:ready`; it blocks on an increase in any file's error count, a new file or rule with errors, or
a gate with no verdict (baseline missing/malformed, ESLint missing or not startable, abnormal ESLint exit, no JSON; exit 2).
Review B-07 fixed: a failed ESLint spawn is a named refusal (was `TypeError: results is not iterable`). Review A-09 fixed: the
settle wrapper logs `AFLDB_NODE_MODULES_DRIFT` only for a real mismatch and `AFLDB_NODE_MODULES_CHECK_FAILED` (exit code, "NOT
verified") when the check did not reach a verdict; still warn-only. Not wired into `deploy/release.mjs`, `deploy/sync-dev.ps1`
or `--mode read-only`.
**Validation:** clean checkout `81afe1bb`: 306 tests pass (`workflow-preflight`, `deploy-release`, `afl-api-ingestion-safety`),
typecheck exit 0, `lint:gate` exit 0 (338/43); reds captured on the base code (`TypeError: results is not iterable`);
negative run (baseline lowered by one) exits 1 in both `lint:gate` and preflight.
**Next action:** publish; resolve O-2 with the publication. Optional: give drift a dedicated exit code in `release.mjs`.

**CHANGELOG Unreleased lines:**
- `preflight --mode implementation|merge` and `merge:ready` run the lint ratchet gate (a ratchet against the 338 existing errors in
  43 files, not clean lint); an increase, a new file with errors, or a gate with no verdict blocks (ISSUE-364).
- The lint gate refuses with a named reason (exit 2) when ESLint cannot be started or the baseline is missing or malformed (ISSUE-364).
- The settle wrapper distinguishes node_modules drift from a check that failed to run in the journal (ISSUE-364).

## 9. Every file changed

Commit `ce47bfa8`: `tools/dev/lint-gate.ts` (rewritten around `evaluateLintGate`/`lintGateFindings`/`parseBaseline`),
`tools/dev/preflight-core.ts` (+`LINT_GATE_MODES`, `lintGateStep`), `tools/dev/preflight.ts` (call, usage, header text),
`tools/dev/merge-readiness.ts` (call, usage, header text), `tests/workflow-preflight.test.ts`, `docs/development/WORKFLOW.md`.
Commit `81afe1bb`: `deploy/afldb-settle-afl-api.sh`, `tests/deploy-release.test.ts`.
Records commit: this directory. `package.json` needed no change (`lint:gate`, `preflight`, `merge:ready` already exist).
`tools/dev/lint-baseline.json` and `deploy/release.mjs` unchanged. The commit trailer says
`Co-Authored-By: Claude Sonnet 5.5` (the model that wrote them), not the Opus line quoted in AGENT-PROTOCOL §3.

## 10. Host and state

Workspace `/mnt/ssd/afldb-rem2-lint364-20261114` (`cand`, `final`, `final-neg`, `out/`), 2.8 GB, left in place. Port 55652 never
used (no database); `ss -ltn` shows no listener on it; no process of mine remains (`pgrep -u arm -af afldb-rem2-lint364` empty).
Raw files here (LF, no CR): `red-all.txt`, `red-final.txt`, `green2.txt` (pre-commit working copy, superseded by `final-run.txt`),
`final-run.txt`, `negative-run.txt`; hashes in `MANIFEST.sha256`.
