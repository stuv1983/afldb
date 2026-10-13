# AFLDB-ISSUE-302 — Lineup bundle records the pinned fitzRoy version as provenance whatever version ran

## 0. Status

- **Status:** **Resolved 2026-10-13** (merge-scoped tooling criteria, §19 and §20). Opened 2026-10-08. Implementation commit `a48cc25662f81c6dcf521023d7834389be260858`, fast-forward merged and pushed to `main` / `origin/main` (operator-verified, §20). D-302-1 and D-302-2 decided (§15). **Tooling-only closure: no deployment, no database contact and no real acquisition was performed.** Sections 17 to 19 retain the pre-merge wording as historical snapshots; §20 is the closure record and §21 the raw `merge:ready` output.
- **Severity:** Low. **Area:** acquisition / provenance.
- **Key files:** `src/lib/acquisition/lineup-bundle.ts`, `tools/rebuild/afl_api/acquire_lineups.R`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-037). Partition R4b raised it as a cross-partition lead; the main session verified it.
- **Classification:** code-proven.

## 1. Summary

`acquire_lineups.R` records `fitzroy_version_installed`, `fitzroy_version_pinned` and `fitzroy_version_match`. It deliberately records a mismatch rather than refusing. The lineup bundle loader takes `fitzroy_version_pinned` as the acquisition's `fitzroyVersion` and never reads the installed version or the match flag. A bundle built with an unpinned fitzRoy therefore states the pinned version as its provenance. The core AFL Tables importer refuses the same mismatch.

## 2. Evidence

- `src/lib/acquisition/lineup-bundle.ts:400-402` (`fitzroyVersion: m.fitzroy_version_pinned`) and `:312` (propagated as `fitzroy_version`).
- `tools/rebuild/afl_api/acquire_lineups.R:155-157` (records all three).
- `tools/migration/import_fitzroy_core.py:958` (refuses `fitzroy_version_match is not True`).
- `tools/rebuild/afl_api/acquire_rosters.R:108-112` (rosters refuse).

## 3. Trigger

Acquiring lineups on a host where the installed fitzRoy differs from the contract pin.

## 4. Expected invariant

The provenance names the version that actually ran, or the bundle refuses a mismatched acquisition (as the core importer does).

## 5. Actual behaviour

The pinned version is recorded as provenance.

## 6. First wrong layer

`src/lib/acquisition/lineup-bundle.ts:400-402`.

## 7. Impact

Misleading provenance on lineup observations. No value corruption is known.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

A repository grep for `fitzroy_version_match` / `fitzroyVersion` shows no consumer check on the lineup path.

## 10. Existing-issue search

None. Classification: **new**.

## 11. Scope

The lineup bundle's provenance.

## 12. Out of scope

The roster and core acquirers (they already refuse).

## 13. Proposed fix boundary

Refuse a manifest whose `fitzroy_version_match` is not `true`, or record `fitzroy_version_installed`.

## 14. Proposed validation

DB-free: `tests/afl-api-lineup.test.ts` with a mismatched manifest.

## 15. Decisions / unresolved questions

- ~~D-302-1: refuse, or record the installed version (operator).~~ **Decided 2026-10-13: refuse.** See below.

**D-302-1 (recorded 2026-10-13, owner-directed):** refuse a lineup manifest unless `fitzroy_version_match === true`, following the roster and core acquirers' existing behaviour (`acquire_rosters.R:108-112` stops on a mismatch; `import_fitzroy_core.py:957-962` refuses unless `fitzroy_version_match is True`). The alternative (record `fitzroy_version_installed`) is not taken: it would keep a bundle built by an unpinned fitzRoy flowing downstream with truthful provenance, but the roster and core paths refuse such input, and this family should not be more permissive.

**D-302-2 (recorded 2026-10-13, owner-directed): scoped primary clean-tree exception for ISSUE-302 integration.** The `merge:ready` primary-checkout clean-tree requirement (§18 step 3) may be excepted for ISSUE-302 integration **only** for the preserved changes below, in the primary checkout `D:\dev\afldb`.

Tracked (diffs reviewed; each is only an appended continuity note, 14 added lines / 0 deleted, verified against the full diff on 2026-10-13):

- `issues/open/AFLDB-ISSUE-274.md` — appended §33.9 (continuity note 2026-10-13, DEV reboot / post-reboot timer check).
- `issues/open/AFLDB-ISSUE-276.md` — appended §17.9 (the same continuity note for ISSUE-276).

Both issues remain **Open**; the 14 Oct combined ISSUE-274 + ISSUE-276 nightly observation and the ISSUE-265 PROD hold remain **pending/unchanged**.

Untracked (15 paths). Raw `git --no-optional-locks -C D:\dev\afldb status --porcelain=v1 --untracked-files=all` on 2026-10-13, which matched this set exactly (17 paths in total, none other). Paths are recorded exactly as Git prints them, literal backticks included, so they are given in a block rather than as Markdown code spans:

```text
 M issues/open/AFLDB-ISSUE-274.md
 M issues/open/AFLDB-ISSUE-276.md
?? .agents/skills/javascript-testing-patterns/SKILL.md
?? .agents/skills/javascript-testing-patterns/references/advanced-testing-patterns.md
?? .agents/skills/nextjs-hydration-audit/SKILL.md
?? .agents/skills/nodejs-backend-patterns/SKILL.md
?? .agents/skills/nodejs-backend-patterns/references/advanced-patterns.md
?? .agents/skills/nodejs-backend-patterns/references/details.md
?? .agents/skills/postgresql-table-design/SKILL.md
?? .agents/skills/typescript-advanced-types/SKILL.md
?? .agents/skills/typescript-advanced-types/references/details.md
?? 0)
?? 20`
?? `path
?? i
?? q(sequenceValueSql(qname))))[0]
?? t.kind
```

**Limits of the exception.**

- It covers **only** the primary clean-tree FAIL caused by exactly the paths above. **All other readiness requirements must pass.**
- **Any additional path, or any change to the content of either tracked diff, requires reassessment** (a numstat match is supplementary evidence only, not proof of unchanged content; compare the full diffs).
- The exception does **not** modify the primary checkout, clean or stash anything, change the readiness tooling, or suppress its FAIL output. The raw `merge:ready` result (including the clean-tree FAIL and its listed paths) is preserved verbatim and reported **separately** from this documented exception.
- It is per-issue and path-scoped, like the ISSUE-312 §18.2, ISSUE-314 §17 and ISSUE-278 close-out exceptions; it does not extend to any other issue. The strays are left in place.

**D-302-3 (recorded 2026-10-13, owner-directed): the same exception for the documentation-only closure merge.** Owner-directed exception to the `merge:ready` primary clean-tree requirement for the **closure-documentation** merge of ISSUE-302 (this runbook's move to `issues/closed/`, the `issues.md` / `IssuesIndex.md` / `CHANGELOG.md` / `blockers.md` updates). It covers **exactly the same preserved primary paths and tracked continuity-note diffs as D-302-2**: the 2 tracked and 15 untracked paths listed in §15 above, in the primary checkout `D:\dev\afldb`.

*Verified before recording (read-only, the two commands authorised for this task, 2026-10-13):*

- `git --no-optional-locks -C D:\dev\afldb status --porcelain=v1 --untracked-files=all` printed **exactly 17 paths**, identical to the D-302-2 block above (2 ` M`, 15 `??`, none other), including the six literal fragment names (`0)`, `` 20` ``, `` `path ``, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`).
- `git --no-optional-locks -C D:\dev\afldb diff -- issues/open/AFLDB-ISSUE-274.md issues/open/AFLDB-ISSUE-276.md` showed the two previously reviewed continuity-note appends and nothing else: `AFLDB-ISSUE-274.md` hunk `@@ -1649,3 +1649,17 @@`, appended §33.9; `AFLDB-ISSUE-276.md` hunk `@@ -341,3 +341,17 @@`, appended §17.9. Each is 14 added lines, 0 deleted, content as described in D-302-2.

*Limits.*

- It permits **only the primary clean-tree failure** ("main worktree is clean"). **Every other `merge:ready` requirement must pass**, and the standing no-runbook-block WARN is the only warning excepted.
- **Any additional path, or any changed tracked diff, voids it.** The primary status and both full diffs must be re-checked against §15 immediately before the closure-documentation `merge:ready`.
- Like D-302-2 it does not modify, clean or stash the primary checkout, does not change the readiness tooling, and does not suppress the FAIL output; the raw result is reported separately from this exception. It is per-issue and path-scoped, and the strays are left in place.

*State: completed versus pending (kept separate).*

- **Completed:** the implementation integration. Commit `a48cc25662f81c6dcf521023d7834389be260858` was merged and pushed under D-302-2, and its raw `merge:ready` output is preserved unaltered in §21 (BLOCKED, one blocker, covered by D-302-2; not a PASS). §21 is not edited by this decision.
- **Pending (none of these has been done, and no result is claimed):** the closure-documentation commit; the documentation `merge:ready` gate under D-302-3, whose raw output will be recorded separately and not substituted for §21; the documentation merge; the push.

## 16. Next action

~~D-302-1.~~ Decided. ~~D-302-2.~~ Decided (§15). ~~Operator review and commit, `merge:ready`, merge, push, closure.~~ **Done 2026-10-13 (§20). No next action on this issue.**

**Amended 2026-10-13 (D-302-3):** "No next action" refers to the *implementation* of ISSUE-302, which is integrated. The closure-documentation commit, its `merge:ready` gate, merge and push remain **pending** (§15, D-302-3).

(Historical wording at the implementation-pass snapshot: "Next: operator review and commit, `merge:ready` (re-verify the primary status against D-302-2 immediately beforehand), merge, push, then closure (§19).")

## 17. Implementation record (2026-10-13; solo session, no agents; local; implementation-pass snapshot, uncommitted at the time)

This section, including its "uncommitted" wording and the §17.3 preflight result, describes the implementation-pass snapshot. It is not updated by later commits; integration state is tracked in §18 and §19.

Worktree `D:\dev\afldb-issue-302`, branch `fix/issue-302`, HEAD `5899c928c61adad50dbba5a1f112b21588ceb55d` (= main), clean before the edits.

### 17.1 Root cause and behaviour

`lineupAcquisitionInput` (the manifest-to-emitter assembly) read `fitzroy_version_pinned` as the acquisition's `fitzroyVersion` and never read `fitzroy_version_match`, so `emit_lineup_bundle.ts` could write a bundle whose `fitzroy_version` named the pin although another fitzRoy ran (`acquire_lineups.R:155-157` records a mismatch instead of refusing).

Now `lineupAcquisitionInput` throws `LineupBundleError` unless `m.fitzroy_version_match === true`, immediately after the existing source/family check and before the season/round, observed-column, artefact and sha checks. A missing, `null`, string, numeric or otherwise non-`true` value is refused exactly as `false` is. The message names the installed version, the pinned version and the observed flag value. A matching manifest behaves as before. `emit_lineup_bundle.ts` calls it as an argument to `buildLineupBundle` and only then calls `writeFileSync`, so a refusal precedes bundle build, serialisation and output.

The brief named `src/lib/ingest/lineup-bundle.ts`; the file is `src/lib/acquisition/lineup-bundle.ts` (as §0 says).

### 17.2 Files changed

- `src/lib/acquisition/lineup-bundle.ts` — the guard (one `if` plus comment, in `lineupAcquisitionInput`).
- `tests/afl-api-lineup.test.ts` — the `acquisition -> emitter assembly` manifest fixture gains `fitzroy_version_installed: '1.8.0'` and `fitzroy_version_match: true`; four tests added: matching manifest keeps pinned version and bundle metadata; mismatched manifest refused with a useful error; missing and malformed (`null`, `'true'`, `1`, `0`, `[]`, `{}`) values refused; a mismatch is refused ahead of other manifest shape errors (guard ordering).
- `issues/open/AFLDB-ISSUE-302.md`, `issues.md` (Open Issues row and entry), `IssuesIndex.md` — tracking for an Open, implemented issue.

Not changed: `acquire_lineups.R`, acquisition behaviour, package pins, other importers, `CHANGELOG.md` (updated at closure, §19). ISSUE-299 untouched.

### 17.3 Validation (all DB-free; no database, host or R acquisition contact)

| Check | Result |
|---|---|
| `npx --no-install vitest run tests/afl-api-lineup.test.ts` | PASS, 1 file, **42 passed / 0 failed / 0 skipped** (four of the 42 are new) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | PASS, exit 0 |
| `npm run preflight -- --mode implementation --issue 302` | **BLOCKED (exit 1), one FAIL: "working tree is clean"** — 2 changed paths, the uncommitted implementation itself, ahead of the docs edits. Every other check PASS (path, branch, linked worktree, contains main, 0 ahead/0 behind origin/main, migration collision-free); 3 WARN (no `.env`, no `psql`, no `pg_restore`, not required for this mode). This is a preliminary result against an uncommitted tree, **not** a merge gate. |
| `git diff --check` | clean (exit 0) |

Preflight was inspected before running (`tools/dev/preflight.ts`, `preflight-core.ts`): in `implementation` mode `dsnEnv` is unset and `--ssh-host` was not passed, so no database connection and no SSH probe ran; it only runs local read-only git and migration-inventory checks.

**Not performed:** (a) a mutation check (disable the guard and see the new tests fail) — the attempt was denied by the session's permission classifier and not worked around, so the new tests are shown to pass but not shown to fail without the guard; (b) the wider suite and integration tests; (c) any real `emit_lineup_bundle.ts` run against an acquisition; (d) the post-commit `merge:ready` (§18).

### 17.4 Environment notes (shared dependency setup, owner-authorised)

- The worktree had no `node_modules`. Owner-authorised: junction `D:\dev\afldb-issue-302\node_modules` -> `D:\dev\afldb\node_modules` (verified `LinkType Junction`, target correct; `vitest`, `next`, `typescript`, `tsx` present; `package-lock.json` SHA-256 identical in both, `435DC97E…4E8E91`). No package installed, updated or removed. Regenerable cache writes inside that gitignored directory were allowed. The junction is gitignored and does not appear in `git status`.
- **Disclosure:** my first `npx vitest …` (without `--no-install`) printed `npm warn exec The following package was not found and will be installed: vitest@5.0.4`, i.e. npx attempted a registry fetch into its own cache before failing to resolve the config import. That breached the brief's no-network-fetch boundary unintentionally. Nothing was installed into the repository or the primary checkout. Later runs used `--no-install`.
- `next typegen` regenerated gitignored `.next` route types in the worktree only.

## 18. Integration steps (planned at the implementation-pass snapshot; since completed, see §20 and §21)

This section is the plan as written before the commit. "Remaining" and "not done" described that moment only; the outcome is in §20.

1. Operator review of the diff, then a local commit of the five files in §17.2 (explicit paths).
2. Post-commit, from `D:\dev\afldb-issue-302`: `npm run merge:ready -- --issue 302 --expected-file src/lib/acquisition/lineup-bundle.ts --expected-file tests/afl-api-lineup.test.ts --expected-file issues/open/AFLDB-ISSUE-302.md --expected-file issues.md --expected-file IssuesIndex.md`. This runbook has no `afldb-merge-readiness` block, so a WARN is expected (standing, as in ISSUE-312 §18.2), and the `--expected-file` list supplies the declared scope.
3. **Preserved changes in the primary checkout (D-302-2).** `merge:ready` checks the primary checkout (`D:\dev\afldb`) and is expected to FAIL its clean-tree check on the primary's preserved changes. The earlier exceptions are per issue and path-scoped (ISSUE-312 §18.2, ISSUE-314 §17, ISSUE-278 close-out) and none covers ISSUE-302; the owner has now recorded **D-302-2** (§15), which excepts that single FAIL for exactly the 2 tracked and 15 untracked paths listed there, and nothing else. Procedure:
   - Immediately before `merge:ready`, re-run the read-only primary status and the full tracked diff of the two issue files, and compare them with D-302-2. Any additional path, or any changed tracked diff, **voids the exception pending reassessment** (do not proceed on it).
   - Run `merge:ready` unmodified. Preserve its **raw output verbatim**, including the clean-tree FAIL and the paths it lists, and report it **separately** from the exception. Do not suppress, filter or reword the FAIL, and do not change the readiness tooling.
   - Every other `merge:ready` check must PASS (the standing no-runbook-block WARN excepted, step 2). A FAIL anywhere else, or a clean-tree FAIL naming a path outside D-302-2, is not covered.
   - Do not modify, clean or stash the primary checkout to obtain a pass.
4. Merge and push (operator); verify main contains the commit and `origin/main` equals it.
5. Closure records (§19) only after step 4 is verified. DEV deploy is not required for a tooling-only change (the lineup bundle is a staging-only path; ISSUE-275's DEV installation hold and ISSUE-265's PROD hold are unaffected and untouched).

## 19. Closure requirements and prepared closure wording (merge-scoped, per ISSUE-312 §17.5)

Closure criteria (statuses as at 2026-10-13 closure; the implementation-pass wording is kept in parentheses):

1. The guard and regression coverage are implemented. **Met** (§17; "uncommitted" at the implementation-pass snapshot, committed as `a48cc256`).
2. Required DB-free validation passes. **Met.** Vitest, typecheck and `git diff --check` at the implementation-pass snapshot (§17.3), and operator-reported again on the committed tree (§20); the post-commit implementation preflight was READY (§20). (At the snapshot, preflight was BLOCKED only by the then-uncommitted tree.)
3. The implementation is committed, merge readiness passes, and merge and push are verified. **Met under D-302-2** (§20). "Passes" means every `merge:ready` check passes **except** the primary clean-tree FAIL, which is excepted **only** for the exact path set in D-302-2 (§15, §18 step 3). The raw `merge:ready` output, FAIL included, is recorded verbatim and separately from the exception (§21); the raw result is BLOCKED, not PASS.
4. Closure records are updated after that verification. **Met by this closure** (`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `blockers.md`, and this file moved to `issues/closed/`), uncommitted until the operator commits them.

Prepared closure wording (retained as written before the merge; the applied closure is §20):

> Resolved <date>. Root cause: `lineupAcquisitionInput` took `fitzroy_version_pinned` as bundle provenance and ignored `fitzroy_version_match`. Fix: it refuses (`LineupBundleError`) any manifest whose `fitzroy_version_match` is not exactly `true` (D-302-1), before any bundle can be built or written. Validation: `tests/afl-api-lineup.test.ts` 42/42 (four new), `npm run typecheck` exit 0, DB-free. Merged as <merge sha>, pushed <date>. Limits: no mutation check, no real acquisition run, no integration tests. `CHANGELOG.md` entry under Unreleased (lineup bundle refuses a fitzRoy version mismatch).

On closure also (planned; done, see §20): move this file to `issues/closed/`, remove the `IssuesIndex.md` entry and the Open Issues row, add the `CHANGELOG.md` entry.

## 20. Closure record (2026-10-13)

**Resolved 2026-10-13, under the merge-scoped tooling criteria of §19.** Tooling-only closure: no deployment, no real acquisition and no database or host contact was performed. The lineup bundle is a staging-only path, and no DEV installation is required for this change.

**Root cause.** `lineupAcquisitionInput` (the manifest-to-emitter assembly in `src/lib/acquisition/lineup-bundle.ts`) took `fitzroy_version_pinned` as the acquisition's `fitzroyVersion` and never read `fitzroy_version_match`. `acquire_lineups.R:155-157` records a mismatch rather than refusing, so a bundle built with an unpinned fitzRoy named the pin as its provenance.

**Fix (D-302-1: refuse).** `lineupAcquisitionInput` throws `LineupBundleError` unless `m.fitzroy_version_match === true`, immediately after the source/family check and before the season/round, observed-column, artefact and sha checks. A missing, `null`, string, numeric or other non-`true` value is refused as `false` is; the message names the installed version, the pinned version and the observed flag. `emit_lineup_bundle.ts` evaluates it before `buildLineupBundle` and `writeFileSync`, so a refusal precedes bundle build, serialisation and output. A matching manifest behaves as before. `acquire_lineups.R` is unchanged (it still records, not refuses, a mismatch).

**Implementation commit:** `a48cc25662f81c6dcf521023d7834389be260858` (`fix(acquisition): refuse unpinned lineup manifests (ISSUE-302)`), parent `5899c928c61adad50dbba5a1f112b21588ceb55d`; the five files of §17.2 (declared scope matched, 5 changed / 5 expected / 0 unexpected, §21).

**Operator-supplied merge and push verification (2026-10-13; not re-run by the closing session):**

- Fast-forward merge and push succeeded. Primary `HEAD`, `main`, `origin/main` and the live remote `main` all equal `a48cc25662f81c6dcf521023d7834389be260858`.
- The primary checkout's status and tracked diffs were unchanged by the merge.
- Post-commit implementation preflight: READY, 0 blockers, 3 environment warnings (the implementation-pass warnings were no `.env`, no `psql` and no `pg_restore`; the post-commit set was reported as a count only).
- Tests: `tests/afl-api-lineup.test.ts` 42 passed, 0 failed, 0 skipped; typecheck passed; `git diff --check` passed.

**Closing-session verification (read-only, the commands authorised for this task, local refs only, no fetch):** branch `fix/issue-302`; `rev-parse HEAD main origin/main` all `a48cc25662f81c6dcf521023d7834389be260858`; worktree status empty (clean) before the documentation edits began.

**Merge readiness and D-302-2 (kept separate).**

- *Raw result:* `npm run merge:ready -- --issue 302 …` returned **BLOCKED, exit 1**, with one blocker: "main worktree is clean" (`D:/dev/afldb`). This is **not** a PASS. The output is reproduced verbatim in §21.
- *Acceptance decision:* D-302-2 (§15) excepts that single FAIL for exactly the 2 tracked and 15 untracked paths listed there. The 17 paths the raw output lists are the D-302-2 set exactly (2 modified, 15 untracked, none other). All other checks PASSed: branch, issue worktree clean, local `main` equals recorded `origin/main`, base/main relationship (1 ahead, 0 behind), migration collision/checksum parity, and committed files matching the declared scope. The `WARN` that the runbook has no `afldb-merge-readiness` JSON block is the standing warning of §18 step 2 and remained. The tooling was not modified and the FAIL output was not suppressed; the primary checkout was not modified, cleaned or stashed, and the strays remain in place. The exception does not extend to any other issue.
- *Note on the raw output:* it was captured before the merge, so it shows `main` and `origin/main` at `5899c928…` and the branch 1 commit ahead; the post-merge equality is the operator-supplied verification above.

**Validation limits.** A mutation check (disable the guard and see the new tests fail) was not performed (§17.3). No wider suite, integration test, real `emit_lineup_bundle.ts` run or real acquisition was run. The test claim therefore is: the new tests pass with the guard; they are not shown to fail without it. The §17.4 environment notes (the `node_modules` junction and the unintended `npx` registry attempt) stand.

**Not affected.** No other issue's status changed. The 14 October combined ISSUE-274 + ISSUE-276 nightly observation and the ISSUE-265 PROD hold remain pending/unchanged. The two tracked primary diffs (ISSUE-274 §33.9 and ISSUE-276 §17.9) and the 15 untracked strays are left as they were.

## 21. Raw `merge:ready` output (verbatim, not a PASS)

Source: `D:\tmp\issue302\merge-ready-20261013-213422.txt`, run from `D:\dev\afldb-issue-302` after the commit. The file is UTF-16LE with a byte-order mark and CRLF line endings; it is reproduced below decoded to text, with the BOM removed and CRLF normalised to LF, and otherwise unaltered (including the FAIL and every listed path). The result is **BLOCKED**; it is covered only by the D-302-2 acceptance decision (§15, §20), which is separate from this output.

```text

> afldb@0.1.0 merge:ready
> tsx tools/dev/merge-readiness.ts --issue 302 --expected-file src/lib/acquisition/lineup-bundle.ts --expected-file tests/afl-api-lineup.test.ts --expected-file issues/open/AFLDB-ISSUE-302.md --expected-file issues.md --expected-file IssuesIndex.md

AFLDB merge readiness (read-only)
No fetch, stage, commit, merge, push, migration or test command will run.

PASS current branch: fix/issue-302
PASS issue worktree is clean
     staged: 0; unstaged: 0; untracked: 0
PASS local main equals recorded origin/main
     main: 5899c928c61adad50dbba5a1f112b21588ceb55d
     origin/main: 5899c928c61adad50dbba5a1f112b21588ceb55d
     No fetch was attempted; fetch/update main separately before treating the recorded ref as current.
PASS base/main relationship
     ahead of main: 1; behind main: 0
FAIL main worktree is clean: D:/dev/afldb
     path:  M issues/open/AFLDB-ISSUE-274.md
     path:  M issues/open/AFLDB-ISSUE-276.md
     path: ?? .agents/skills/javascript-testing-patterns/SKILL.md
     path: ?? .agents/skills/javascript-testing-patterns/references/advanced-testing-patterns.md
     path: ?? .agents/skills/nextjs-hydration-audit/SKILL.md
     path: ?? .agents/skills/nodejs-backend-patterns/SKILL.md
     path: ?? .agents/skills/nodejs-backend-patterns/references/advanced-patterns.md
     path: ?? .agents/skills/nodejs-backend-patterns/references/details.md
     path: ?? .agents/skills/postgresql-table-design/SKILL.md
     path: ?? .agents/skills/typescript-advanced-types/SKILL.md
     path: ?? .agents/skills/typescript-advanced-types/references/details.md
     path: ?? 0)
     path: ?? 20`
     path: ?? `path
     path: ?? i
     path: ?? q(sequenceValueSql(qname))))[0]
     path: ?? t.kind
PASS migration collision/checksum parity (refs/remotes/origin/main)
INFO database migration parity not checked
     Use the appropriate operational preflight when a database target is part of the merge contract.
WARN runbook readiness metadata unavailable: issues/open/AFLDB-ISSUE-302.md
     runbook has no afldb-merge-readiness JSON block
PASS committed files match the declared issue scope
     changed: 5; expected rules: 5; unexpected: 0

Merge readiness: BLOCKED (1 blocker(s), 1 warning(s)).
```
