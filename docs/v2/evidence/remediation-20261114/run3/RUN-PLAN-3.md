# Remediation run 3 — run plan (owner-authorised 2026-11-14)

Integration branch `claude/remediation-20261114`, start tip `6d5388ea` (run-2 candidate), executable revision Q = `f10e47ad`.
origin/main `de640826`. Nothing is pushed. Plan review: `PLAN-REVIEW-3.md` (PROCEED; 8 MED folded in below).
Common brief: `AGENT-BRIEF-COMMON-3.md`. Agent returns are persisted verbatim under the gitignored
`.phaneslight/returns/rem3-20261114/` of the integration worktree.

| Step | Scope | Agent | Host port | Depends on |
|---|---|---|---|---|
| 1 | `stateb`: T363-1 (`settle-afl-api-state-b` owns its provider id; residue/cleanup scoped to owned rows; snapshot row unchanged), stretch: the same pattern in `settle-afl-api` (F-002) | worker | 55671 | — |
| 2 | `rebuild`: input inventory + standard isolated rebuild `afldb_v2_rb_rem3_test` (`--target isolated`), dump for step 3 | worker | 55672 | — |
| 3a | `integ` phase A: intended conditions of the refuse-by-design / precondition suites; war years; phase-B runner | worker | 55673 | — |
| 3b | `integ` phase B: the runner against the rebuilt dump | worker | 55673 | 2, 3a |
| 4 | integrate (cherry-pick -x) into `claude/remediation-20261114`; Q′; final qualification in a fresh workspace (QUALIFICATION-2 checks) | orchestrator + worker | 55674 | 1, 3b |
| 5 | ledgers: ISSUE-363 status and any others touched; Open Issues table; `IssuesIndex.md`; `CHANGELOG.md` | orchestrator | — | 4 |
| 6 | publication review, packet 3, qualification 3, residuals 3, handoff; `afldb-closure` verification | orchestrator + closure | — | 5 |

## Plan-review mitigations adopted
- F-001: fresh template copy per red attempt and per ordering; never delete-and-restore a snapshot row.
- F-002: `settle-afl-api` deletes the same snapshot row (`:772`); attempted as a stretch in step 1, otherwise listed as remainder; ISSUE-363 is at most "partially resolved" while T363-2/T363-3 shared-mode effects remain.
- F-003/F-004: the rebuild runs only as `isolated-pg run … rebuild-test.ts --target isolated --acknowledge-destroy afldb_v2_rb_rem3_test`, from a `.env`-free workspace; every port explicit and new; every vitest run through `isolated-pg run`.
- F-005: name-pinned suites in shared mode on their named clones; no `afldb_v2_rb_` per-file prefix.
- F-006: dedicated-clone conditions only from the documented recipe and retained artefacts.
- F-007: six-class vocabulary; id universe 53 (52 + war years); the rebuild's fitzRoy label and ledger recorded.
- F-008: if `git diff R..Q′` touches rebuild inputs/code, rebuild again, else carried by file identity; every script used for Q′ evidence committed at or before Q′.
- F-009: pin freeze extended to Coleman, awards/honours and ladder contracts.
- F-010: the run-3 rebuild is an isolated database under today's authorisation; it does not adopt decision (3) or rebuild the shared `afldb_test`.
