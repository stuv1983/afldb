# AFLDB-ISSUE-299 — R lineup and roster acquirers overwrite retained evidence in place

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Fix merged as `091e4635` and validated without the network (§17); the §14 networked double run was run on 2026-10-15 for both acquirers and the second run was refused each time (§19). **Not deployed.**
- **Severity:** Low. **Area:** acquisition tooling / evidence retention.
- **Key files:** `tools/rebuild/afl_api/acquire_lineups.R`, `tools/rebuild/afl_api/acquire_rosters.R`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-034; partition note R4b-F04).
- **Classification:** code-proven.

## 1. Summary

Both R acquirers use a deterministic default label (no timestamp) and create the output directory silently when it already exists. A second run with the same scope therefore rewrites the artefact and `manifest.json` over the first. That is the silent-overwrite hazard `src/lib/acquisition/snapshot-dir.ts` was added to prevent for the TypeScript acquirers.

## 2. Evidence

- `acquire_lineups.R:76, :80, :111` (default label `afl-api-lineups-<season>-r<round>`, `dir.create(showWarnings = FALSE)`).
- `acquire_rosters.R:94-95, :131`.
- `src/lib/acquisition/snapshot-dir.ts` and `issues.md:39507-39555` (the TypeScript fix).
- `afl-api-contract.json:91-93` protects the accepted roster snapshot only after the fact.

## 3. Trigger

`Rscript tools/rebuild/afl_api/acquire_lineups.R --season 2026 --round 20`, run twice.

## 4. Expected invariant

An existing output directory is refused, or the default label is timestamped.

## 5. Actual behaviour

The prior evidence is overwritten.

## 6. First wrong layer

`acquire_lineups.R:76-111`; `acquire_rosters.R:94-131`.

## 7. Impact

Loss of the prior evidence bytes. The accepted roster snapshot's sha check later refuses to use the result, but the original bytes are gone.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no `dir.exists` refusal.

## 10. Existing-issue search

`acquire_lineups` / `acquire_rosters` appear in design entries only (`issues.md:8928, :9077`). Classification: **new**.

## 11. Scope

The two R scripts.

## 12. Out of scope

The TypeScript acquirers (already safe).

## 13. Proposed fix boundary

Refuse an existing out_dir, or timestamp the default label.

## 14. Proposed validation

Run twice with the same scope into a scratch `--out-dir` (operator-run; network) and expect a refusal on the second run.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

`tools/rebuild/afl_api/acquire_lineups.R` and `acquire_rosters.R` each gain the same guard directly after `out_dir` is computed: an output directory that already exists **and is not empty** (`dir.exists(out_dir) && length(list.files(out_dir, all.files = TRUE, no.. = TRUE)) > 0L`, hidden files included) stops the script with `Output directory '<dir>' already exists and is not empty; a second acquisition would overwrite the retained evidence and its manifest.json. Choose another --label or --out-dir, or move the existing directory aside deliberately.` It runs before the contract is read, before `dir.create` and before any network call, so a refusal costs nothing. This is the runbook's first option (refuse), not the second (timestamp the default label), so a re-acquisition into the same label now needs the existing directory moved aside deliberately. An existing **empty** directory (an operator-prepared scratch directory) is still accepted. No change to the TypeScript acquirers.

### 17.2 Tests

`tests/afl-api-lineup.test.ts` (DB-free; it already reads the lineup adapter's source), a new block `AFLDB-ISSUE-299`, four cases:

- Static, per adapter: the guard's exact condition is present, it follows a `dir.exists(out_dir)` test, and it comes before the contract read, `dir.create(out_dir` and the last `fitzRoy::fetch_` mention (the header comments name `fetch_*`, so the call is the last).
- Behavioural, per adapter (skipped when `Rscript` or the `fitzRoy` package is absent): the real script is run with a non-empty `--out-dir`. It exits non-zero, its stderr carries `Error: Output directory '...' already exists and is not empty` (the refusal itself, not a warning that lets a later failure stand in), the output never says `Fetching`, the directory still holds exactly its one file with its bytes, and no `manifest.json` appeared.
- **Safety belt.** Were the guard ever removed, the script would go on to fetch from the AFL API. The behavioural cases therefore run `Rscript` with every `http(s)_proxy` variable pointing at `127.0.0.1:9`, where nothing listens, so any request fails with a connection error instead of acquiring anything. That was checked by hand first, against the unfixed script: it attempted only `127.0.0.1:9` (`Failed to connect to 127.0.0.1 port 9`) and wrote nothing into the scratch directory.

### 17.3 Results

- **Fixed code.** `tests/afl-api-lineup.test.ts`: **46 passed** (4 new, the two behavioural ones executed). No database and no network were used; R 4.6.1 with fitzRoy was present.
- **Unfixed scripts** (`git checkout HEAD -- tools/rebuild/afl_api/`, the fixed files copied back and byte-restored): all 4 new cases fail (the behavioural ones after about 2.4 s, at the proxy refusal).
- **Mutants** (`D:\tmp\issue299\mutate.mjs`, each against both adapters, original bytes restored and hash-verified after each): the guard removed (A1), an empty directory refused (A2), `stop` weakened to `warning` (A3), hidden files ignored (A4). **All 8 killed** (A3 only after the behavioural assertion was tightened to require the refusal as the error; the first version would have let it survive).
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the test file exits 0 on this branch and on unchanged `main`.

### 17.4 Limits

- Not deployed; no network, DEV or PROD action. The R scripts' successful path (an absent output directory, the real fetch, the manifest) was not run: it needs the AFL API.

### 17.5 Why this issue stays open

§14 specifies the validation as an operator-run, networked procedure: run the acquirer twice with the same scope into a scratch `--out-dir` and expect a refusal on the second run. Provider/network acquisition was outside this work's authority, so that procedure has not been run. What was shown instead is the second-run state itself (an existing, non-empty directory) refused by the real scripts, with no network. The issue closes once an operator has run §14 once (two real runs, the second refused) or accepts the local evidence.

## 18. Readiness and merge (2026-10-15; the issue stays open, §17.5)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 299` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue299\preflight-1.txt`). `npm run merge:ready -- --issue 299` (raw, unchanged: `D:\tmp\issue299\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The six committed paths were compared with the declared scope by hand: the two R acquirers, the lineup test, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`). Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `091e4635` (fix, tests and records) fast-forwarded onto `main` and was pushed (`a5b17f24..091e4635`); local `main` and `git ls-remote origin refs/heads/main` both equalled `091e4635` afterwards. Merge-scoped only; not deployed. The issue is not resolved.

## 19. The §14 networked double run (2026-10-15)

### 19.1 Method

From the primary checkout at `main` (tracked tree clean), with R 4.6.1 and the pinned fitzRoy 1.8.0, each acquirer was run **twice with the same scope into a fresh scratch `--out-dir` that did not exist beforehand**, under `D:\tmp\issue299\double-run-20261015\`. Scope was bounded to one lineup round and one roster season. The default `data/sources/afl_api/...` working root was never used. The first run of each reached the AFL API; the second was run with the same arguments immediately after, with the first run's files hashed before and after.

- `Rscript tools/rebuild/afl_api/acquire_lineups.R --season 2026 --round 20 --out-dir <scratch>\lineups-scratch`
- `Rscript tools/rebuild/afl_api/acquire_rosters.R --from 2026 --to 2026 --out-dir <scratch>\rosters-scratch`

### 19.2 Results

| | First run | Second run (same arguments, same directory) |
|---|---|---|
| Lineups | exit 0; 468 rows, 9 matches, 18 team instances; `lineups_2026_r20.json` (321,299 bytes, sha-256 `c85e1ec7...06d2d4`) and `manifest.json` (`d5be7044...ab9e`) | **exit 1** with `Error: Output directory '...\lineups-scratch' already exists and is not empty; a second acquisition would overwrite the retained evidence and its manifest.json. Choose another --label or --out-dir, or move the existing directory aside deliberately.`; output never says `Fetching`; both files byte-identical (hashes equal before and after) |
| Rosters | exit 0; 812 rows, 18 teams, 812 with height; `rosters_2026.json` (415,413 bytes, sha-256 `019c1315...7d52e`) and `manifest.json` (`4fa50f4c...369449`) | **exit 1** with the same refusal for `...\rosters-scratch`; output never says `Fetching`; both files byte-identical |

Evidence: the output logs and both scratch directories under `D:\tmp\issue299\double-run-20261015\` (full hashes: `lineups-run2.combined.txt` `7d91e4e2...`, `rosters-run2.combined.txt` `d1886958...`). The network was used by the two first runs only (one lineup fetch for one round, one squad fetch per club for one season); the refusals cost no request.

### 19.3 Closure

The runbook's §14 procedure (two real runs, the second refused) was run for both scripts and behaved as specified, which closes the condition in §17.5. Resolved, **merge-scoped**: the scripts are workstation tooling with nothing to deploy beyond the checkout; nothing was written outside the scratch directories.

## 20. Readiness, merge and closure record (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 292` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issuerec1015\preflight-1.txt`). `npm run merge:ready -- --issue 292` (raw, unchanged: `D:\tmp\issuerec1015\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The committed code paths were compared with the declared scope by hand.
- **Exception.** The owner retained the exact **18**-path primary-state exception for this batch (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`), covering only that clean-tree FAIL. A 19th path, a zero-byte `0` created at 11:47 that day, appeared and made the exact-path check fail; the owner answered a direct question by authorising its deletion, and it was deleted (empty, untracked) before any merge. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146...2500`, unchanged), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
