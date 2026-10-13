# AFLDB-ISSUE-314 — `prepare-promotion-source --apply` checks `--record-out` only after committing its writes

## 0. Status

- **Status:** **Open** (2026-10-08). **Implemented locally 2026-10-13** on `sonnet/issue-314` (`D:\dev\afldb-issue-314`, base `24ca412b`); DB-free validated (§17);
  **uncommitted, not merged, not pushed**. Remaining criteria: §17.5.
- **Severity:** Low. **Area:** database tooling / production promotion preparation.
- **Key file:** `tools/db/prepare-promotion-source.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-049; partition note R6b-F02).
- **Classification:** code-proven.

## 1. Summary

The only existence check for `--record-out` is the final `writeFileSync(…, { flag: 'wx' })`, which runs after every apply step has committed to `afldb_test`. A pre-existing path therefore leaves a prepared source with no preparation record. `--phase source` requires that record, and the tool's own wording says an unrecorded prepared source must be rebuilt.

## 2. Evidence

- `tools/db/prepare-promotion-source.ts:145-191` (argument parsing checks presence only), `:596-657` (apply steps commit), `:708` (`wx` write) and `:725-728` (raw error, exit 1).
- `tools/db/promotion-check.ts:771-784` (requires `--preparation-record`).
- Contrast: the refuse-before-connect pattern in `promotion-check.ts:3938, :3961, :3988-3990, :2897` and `afl-api-ownership-census.ts:116-118`.

## 3. Trigger

`npm run db:promotion:prepare-source -- --apply --record-out <existing path>`.

## 4. Expected invariant

Refuse before any connection is opened.

## 5. Actual behaviour

All writes commit, the record write fails, and the operator is left at a dead end (a fresh `db:test:rebuild` of about 21 minutes, plus preparation).

## 6. First wrong layer

`prepare-promotion-source.ts:708` (the late check).

## 7. Impact

An operational dead end caused by a path typo. No corruption.

## 8. Reproduction / witness

Not executed. The tests and the ISSUE-252 rehearsal inject `writeRecord`, so neither exercises the default path.

## 9. Disproof attempts

`existsSync` is used only for inputs (`:257, :289, :378`).

## 10. Existing-issue search

ISSUE-252 (resolved); `record-out` appears only in usage lines. Classification: **new**.

## 11. Scope

The output-path pre-check.

## 12. Out of scope

The preparation steps themselves.

## 13. Proposed fix boundary

`existsSync(resolve(args.recordOut))` refusal right after `parsePrepareArgs`.

## 14. Proposed validation

DB-free vitest case in `tests/db-promotion-check.test.ts`: an existing path with a `prove` dependency that throws if reached must reject before `prove` is called.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Implemented and DB-free validated 2026-10-13 (§17). Remaining: §17.5.

## 17. Implementation and DB-free validation (2026-10-13; solo, no agents)

Worktree `D:\dev\afldb-issue-314`, branch `sonnet/issue-314`, base `24ca412baa531db75cf5ea3a4839b988f6077993` (= `main` = freshly fetched `origin/main`).
`preflight -- --mode implementation --issue 314`: READY, 0 blockers. No database, host, commit, merge, push or deployment. The worktree was made with
`git worktree add -b` at the exact SHA because `worktree:bootstrap` refuses main's untracked skill files and a stray zero-byte `20`` file; none of them was touched.

### 17.1 Change (`tools/db/prepare-promotion-source.ts`)

- New exported `recordOutProblems(recordOut)`: reads the filesystem only. It reports a parent that is not a directory or does not exist, and any existing path
  (`lstat`, so a file, a directory or a symbolic link, dangling or not, which the exclusive `wx` write also refuses).
- `runPreparePromotionSource` calls it right after `parsePrepareArgs`, **before** the offline snapshot and bridge verification and before any connection, and refuses with
  `STOP: --record-out cannot be created. Nothing has been verified, opened or written; …`. Only `--apply` has a `--record-out` (the parser already enforces that).
- The final `writeFileSync(…, { flag: 'wx' })` is unchanged and remains the backstop.
- `docs/production-promotion.md` (§ prepare-source): one paragraph states the rule and its limits.

Scope note: the parent-directory check goes slightly beyond the runbook's `existsSync` proposal (§13). It is the same defect (a predictable `wx` failure found only after the commits), and the
existing rehearsal already creates its `preparation/` directory first. No preparation step, argument, record format or exit code changed.

**Second pass (13 Oct 2026, after the operator's review request).** A parent that is a regular file was already refused (`its parent '…' is not a directory`, covered). A regular file *further up* the path
(`a-file/sub/prep.json`) was refused before connecting too, but with a misleading "does not exist or cannot be read" (probed with `tsx` against a temp directory before the change). The parent message is now
`its parent directory '…' does not exist (or a component of its path is a file)` for both `ENOENT` and `ENOTDIR` (a file above the parent is `ENOTDIR` on POSIX, `ENOENT` on Windows), and any other error code reports
`cannot be inspected (<code>)`. The `cannot be inspected` branch (for example `EACCES` on the parent) has no test.

### 17.2 Not predicted by the check (still found only by the final write)

A directory the process cannot write to, a full disk, and a path created by another process after the check. Disclosed in the function comment and in the doc paragraph.

### 17.3 Validation (DB-free; operator-authorised run, 13 Oct 2026, Windows)

- `npx vitest run tests/db-promotion-check.test.ts` on `main` (`24ca412b`): **456 passed (456)**. First pass: 463 passed | 1 skipped (464), 8 new cases. **Final (second pass): 464 passed | 1 skipped (465), i.e. 9 new
  cases: 8 passed, 1 skipped** (the added case: a parent that is a regular file, and a file further up the path, each reported once). Retained first-pass evidence below is unchanged.
- New cases (`describe('ISSUE-314: --record-out is checked before anything is verified, opened or written')`): an existing file is refused with the offline verifiers made to throw if reached, `calls` empty,
  nothing written, the existing file's bytes unchanged; the same on the **default** writer (no other case in the file reaches it); an existing directory, a missing parent and a parent that is a file are each
  refused with their reason and nothing is created; a new file in an existing directory runs to the end on the default writer, writes a parseable record, and a second run to the same path is refused up front with
  the first record intact; `--validate-only` and `--dry-run` are unaffected; `recordOutProblems` direct cases (clean path, relative path, missing parent creates nothing).
- **Mutation check (first pass, retained):** with the guard disabled (`if (false && …)`), **4 of the new cases fail** (existing file, default writer, directory/parent cases, and the second-run refusal); restored, 463 passed | 1 skipped.
- **Second mutation check:** with the parent-is-a-directory check short-circuited, 3 cases fail (the parent/ancestor-file case, the direct parent-file case, and the missing-parent case, because the short-circuit also skips the
  `statSync` call); restored, 464 passed | 1 skipped.
- *(History, as at the Windows run; superseded for the gate by the Linux run, §17.8.)* **Skipped on this host:** the dangling-symbolic-link case (`symlinkSync` needs a privilege here). It is **not counted as passed**. The only local Linux environment (WSL Ubuntu on the workstation) has no Node, nothing was installed,
  so the project case could not run there. **Linux premise evidence only** (`D:\tmp\issue314\linux-pack\premise.py`, Ubuntu's `python3 -I`, scratch under `/tmp`, removed; 9/9 PASS): a dangling link is invisible to a
  `stat`-based exists check, visible to `lstat`, and refused by the exclusive create (`EEXIST`); a file above the path gives `ENOTDIR`. That supports the `lstat` choice; it is not the project test. The pack
  (`D:\tmp\issue314\linux-pack\README.md`) states the outstanding run: `npx vitest run tests/db-promotion-check.test.ts -t "ISSUE-314"` on a Linux host with Node, expecting 9 passed, 0 skipped.
- `npx tsc --noEmit` exit 0; ESLint on the two changed code files: 0 errors, 2 warnings (`_dropped` unused at `tests/db-promotion-check.test.ts:4320` and `:4468`, outside this change); `git diff --check` clean.

### 17.4 Not done

- `tools/db/promotion-source-dependency-rehearsal.ts` (the `code_test_db` rehearsal that calls `runPreparePromotionSource` with real `--record-out` paths) was **not run**: it needs a database. By reading, every path
  it passes is a fresh name in the `preparation/` directory it creates first (`:1622`), so the new check does not refuse them.
- No real `npm run db:promotion:prepare-source -- --apply` (about 21 minutes of rebuild plus preparation) and no live demonstration of the refusal against `afldb_test`.

### 17.5 Approved closure criterion, remaining criteria and next action

**Closure criterion (APPROVED by the operator, 13 Oct 2026):** the documented pre-connection guard is validated, the complete change is reviewed, and the implementation and closure records are merged and pushed.
This does **not** claim a real promotion, a real `--apply`, or any deployment or DEV/PROD acceptance (none is applicable to this operator-run `afldb_test` preparation tool).

**Closure gate added (operator instruction, 13 Oct 2026; supersedes the earlier "optional-but-recommended" wording of item 5 below):** the Linux ISSUE-314 test run is an **explicit closure requirement**.
`vitest run tests/db-promotion-check.test.ts -t ISSUE-314` on Linux must show **9 selected cases, 9 passed, 0 failed, 0 skipped**, the dangling-symbolic-link case among the passes, run against bytes verified equal to the reviewed
seven files (§17.7). The Python premise checks (`premise.py`, 9/9) are supporting evidence only and cannot satisfy this gate. The issue is not Resolved, and the closure records are not written, until the result is recorded here.
**Gate MET and recorded 13 Oct 2026 (§17.8).** The issue remains Open: items 1-4 below (commit, merge:ready, merge and push, closure records and push) are still outstanding.

Status against it:

| Part | State (13 Oct 2026) |
|---|---|
| Guard validated | DB-free: 464 passed \| 1 skipped (§17.3), two mutation checks. **The dangling-symlink case is skipped on Windows and is not counted as passed there**; *as written 13 Oct 2026 before the Linux run: "Linux premise evidence only (§17.3)"*. **Since the Linux run (§17.8) the case has passed on Linux.** |
| Complete change reviewed | Assistant full review of all seven files: §17.6, no CRIT/HIGH/MED finding. The operator's own review of the diff is still the commit gate (item 1). |
| **Linux gate:** 9 selected, 9 passed, 0 failed, 0 skipped | **MET (13 Oct 2026, `streamanator`, Node v22.23.2): 9 selected, 9 passed, 0 failed, 0 skipped, dangling-symlink case passed; evidence §17.8.** *History: earlier on 13 Oct 2026, before the pack was built and run, this row read "NOT MET. Not run. Pack authored, not yet built; no host contacted; prerequisites open (§17.7)."* |
| Implementation and closure records merged and pushed | **Not done.** Nothing is committed. |

Remaining, in order (operator):

1. Review and commit the seven files named in §17.6, explicit paths, as the implementation commit. Not `20`` and not the untracked `.agents/skills/` folders.
2. `npm run merge:ready -- --issue 314`. Main carries untracked files (the skill folders and `20``), so earlier cleanliness exceptions (ISSUE-273 §22.1) do **not** cover this: the clean-tree check will FAIL on main unless a fresh,
   scoped exception is recorded or those files are moved aside.
3. Merge to main and push.
4. **Closure records** (status Resolved, removal from `IssuesIndex.md` and the Open Issues table, `CHANGELOG.md` wording, `issues/open/` -> `issues/closed/AFLDB-ISSUE-314.md`) are *not* written yet: they need the pushed
   implementation SHA and the issue must stay Open until then. Plan: a second documentation commit carrying them, merged and pushed under the same criterion; the issue is Resolved when that push is done.
5. **CLOSURE GATE (required, operator 13 Oct 2026):** the Linux run of `vitest run tests/db-promotion-check.test.ts -t ISSUE-314`, 9 selected passed / 0 failed / 0 skipped, using the verification pack and procedure of §17.7
   (supersedes the earlier `linux-pack\README.md` instruction, which is retained as evidence). Record the result, the pack hashes (`D:\tmp\issue314\linux-verify-pack\BUILD-EVIDENCE.md`) and `EVIDENCE.sha256` in the closure-records commit (item 4), not before the pack is built and frozen.
   **DONE 13 Oct 2026: run, accepted and recorded in §17.8** (the freeze was lifted by the operator for that record). Until it is recorded, the dangling-symlink behaviour is
   shown by Linux premise evidence only, and that evidence does not satisfy the gate.

The issue stays **Open** until items 1-4 are done (item 5 is met, §17.8).

### 17.6 Full review of the seven-file diff (assistant, 13 Oct 2026; no subagents)

Scope: `tools/db/prepare-promotion-source.ts`, `tests/db-promotion-check.test.ts`, `docs/production-promotion.md`, `issues/open/AFLDB-ISSUE-314.md`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

- **Actual CLI ordering (read, `prepare-promotion-source.ts`):** `main()` `:762` calls `loadEnv(DEFAULT_PROJECT_ROOT)` (`tools/current-season/load-env.ts`: reads `<root>/.env` into `process.env`, no connection) and then
  `runPreparePromotionSource`. There: `parsePrepareArgs` -> **`recordOutProblems` guard `:564`** -> `inProgressSeasonsOf` and the offline snapshot/bridge verification `:572` onward -> the only `postgres(...)` connection `:605`
  -> the apply steps -> the final **exclusive write `:753` (`flag: 'wx'`, unchanged)**. So an invalid `--record-out` is refused before verification, any connection and any write. The entry-point process was **not** executed
  (that is a `db:promotion:*` command); the order is shown by the code and by the in-process tests whose offline verifiers, bridge verifier and `prove` throw or record if reached.
- **Parent path that exists as a regular file:** refused before connecting (direct parent: `is not a directory`; a file further up: the corrected message in §17.1). Covered by tests and a mutation check. No case in this class is missed.
- **Backstop intact:** the default writer is still `writeFileSync(path, text, { flag: 'wx' })`; one test uses it for a success and a second-run refusal.
- **Findings:** one LOW diagnostic defect found and fixed in review (the misleading ancestor-file message, §17.1). No CRIT/HIGH/MED. Residual, accepted and documented: unwritable directory, disk full, a path created after the
  check (all found only by the final write); the untested `cannot be inspected` branch; the check is not atomic with the write by design.
- **Documentation accuracy:** `docs/production-promotion.md` paragraph states the rule and the same limits; it does not claim the dangling-link case or any live run. Tracking files say "Open", "uncommitted", "not merged".
- **Other callers:** `promotion-source-dependency-rehearsal.ts` passes fresh names in a directory it creates first; not run (database).
- **Exact commit scope:** the seven files above, nothing else. The Linux pack lives outside the repository (`D:\tmp\issue314\linux-pack\`) and is not part of the commit.

### 17.7 Linux closure-gate verification pack (authored 13 Oct 2026; solo, no agents; at authoring: NOT built, NOT run; built, run and accepted the same day, §17.8)

Location (outside the repository, not part of the commit; `linux-pack\` above is preserved untouched): `D:\tmp\issue314\linux-verify-pack\`. Authored there: `build-pack.mjs`, `run-issue314.mjs`, `verify-tree.mjs`,
`verify-deps.mjs`, `remote-run.sh`, `REMOTE-PROCEDURE.md`, `VERIFY-BYTES.md`. The operator runs `node D:\tmp\issue314\linux-verify-pack\build-pack.mjs` (read-only git; writes only `...\out\`), which produces `tree.tar`
(every file tracked at `24ca412b` as raw stored blobs, with the seven reviewed files laid over as the bytes git would store), `manifest.json` (git blob id + SHA-256 per file; separate source/test/config/lockfile sections),
`SHA256SUMS` and `reviewed-seven-files.diff`. It refuses unless `HEAD` is the base, the tracked changes are exactly the seven files and nothing is staged. No `.env`, credentials, Windows `node_modules` junction, `20``,
or untracked skill folders are packed. **Any edit to the seven files after the build voids the pack (rebuild).** This runbook is one of the seven and was edited to add this gate; the two executed files were not edited by it.

**Pack hashes and build evidence are held OUTSIDE the repository** (`D:\tmp\issue314\linux-verify-pack\BUILD-EVIDENCE.md`, written at build time). These seven files are frozen when the pack is built and carry no pack hash. The Linux
result and the pack hashes are copied into the repository only by the later closure-records commit (§17.5 items 4-5); that edit changes documentation files only, never the two executed files.

Run (proposal; needs the operator's explicit go-ahead to contact the host): `scp -r out dev:$S`; `ssh dev "sh $S/remote-run.sh $S /home/arm/projects/afldb/node_modules /home/arm/.nvm/versions/node/v22.23.2/bin v22.23.2"`;
the script leaves `$S/evidence.tar` inside the isolated directory and the operator retrieves it with `scp dev:$S/evidence.tar <new local dir>` (no binary data through a redirected ssh stdout). In a fresh scratch directory on `streamanator`,
`remote-run.sh` runs only the pinned Node file (refusing before any unpack or copy if its real version differs), verifies the uploaded pack, unpacks it, **copies** the host's existing Linux `node_modules` (reads the live checkout, never writes it), then `run-issue314.mjs` verifies the tree bytes and the dependencies
(lockfile vs installed, platform, links that leave `node_modules`, Node vs engines) **before** executing, runs the command via an argument array with `shell:false` in a minimal private environment (private `HOME`, `TMPDIR`,
caches; no `AFLDB_*`/`DATABASE_URL`/`PG*`, no `.env`), re-verifies the tree, and writes stdout, stderr, exit status, selected counts and `EVIDENCE.sha256`. Filesystem effects are confined to the scratch directory.
Disclosed difference from the bare command: the runner adds `--reporter=verbose --reporter=json --outputFile.json=...` so the selected counts are measured.

**Unresolved prerequisites:** (1) Node on `streamanator`: the candidate `/home/arm/.nvm/versions/node/v22.23.2/bin/node` (13 Oct installation evidence) is verified at run time, not yet; (2) the host's `node_modules` must be a full, dev-inclusive Linux install matching the packed lockfile, which is
unknown until `verify-deps` runs there (if it fails, the alternatives are an operator decision; an `npm ci` is not authorised); (3) the operator's go-ahead for scp/ssh; (4) pack size unknown until built; (5) the pack scripts have
had no remote execution; their local syntax check and the build are recorded in `BUILD-EVIDENCE.md` (outside the repository). The closure gate in §17.5 stayed unmet until the Linux result was recorded (history as at the pack build; the run and its acceptance are §17.8).

### 17.8 Linux closure-gate run: ACCEPTED (13 Oct 2026, 01:56Z; operator-authorised, DB-free, isolated; solo, no agents)

**Result: gate MET.** `vitest run tests/db-promotion-check.test.ts -t ISSUE-314` on Linux: **9 selected cases, 9 passed, 0 failed, 0 skipped, 0 other; the dangling-symbolic-link case (`recordOutProblems refuses a dangling symbolic link…`) passed.**
Vitest's own summary line: `Tests 9 passed | 456 skipped (465)`, where the 456 are the cases excluded by the `-t` filter (not selected, not counted against the requirement). Exit status 0, stderr 0 bytes, test duration 3.80 s.
The Python premise checks played no part in the verdict (supporting evidence only, §17.3).

- **Host.** `arm@10.0.40.100`, `hostname` `streamanator`, `Linux 6.8.0-146-generic x86_64`, user `arm`; checked over an explicit-address connection before upload. **Node** `/home/arm/.nvm/versions/node/v22.23.2/bin/node` = `v22.23.2`, pinned and matched
  (`remote-run.sh` refuses before any unpack or copy on a mismatch). vitest 4.1.10 (engines `^20 || ^22 || >=24`: ok), tsx 4.23.12, typescript 5.9.3.
- **Isolated directory** (retained, not removed): `/home/arm/issue314-verify-20261013T015633Z`; 01:56:46Z to 01:56:56Z. Nothing was installed; no database, promotion, rebuild, deployment or service action; no repository file was changed by the run.
- **Source bytes.** The pack's `SHA256SUMS` was checked remotely (9 of 9 OK) before unpacking. The unpacked checkout was exact **before and after** the test: 1,864 files expected and present, 0 missing, 0 altered, 0 extra, 0 symbolic links
  (`tree-before.json`, `tree-after.json`).
- **Dependencies and caches.** `verify-deps` ran before the test: OK; linux/x64; 24,472 `node_modules` entries; 426 lockfile packages compared, 120 not needed on this platform; 0 failures. The host's existing Linux `node_modules`
  (`/home/arm/projects/afldb/node_modules`) was **copied** into the scratch checkout (read-only source); the command ran with a minimal private environment (private `HOME`, `TMPDIR`, `XDG_*`, `npm_config_cache`, all under the scratch directory;
  no `AFLDB_*`, `DATABASE_URL` or `PG*`; no `.env`), through an argument array with `shell:false` (`result.json` `vitest.argv`, `vitest.shell`). Disclosed addition to the bare command: `--reporter=verbose --reporter=json --outputFile.json=…`, so counts are measured.
- **Live-checkout tripwire.** The stat sentinel on the live DEV checkout (`node_modules`, `.package-lock.json`, `.vite`, `package*.json`, `.next`, `.git/HEAD`, `.git/index`) was identical before and after; `node_modules/.vite` was absent before and after.
- **The five `verify-deps` warnings** (all optional packages absent; none required on this platform; the run passed regardless): `@emnapi/core@1.10.0`, `@emnapi/wasi-threads@1.2.1`, `@napi-rs/wasm-runtime@1.2.3`, `@tybys/wasm-util@0.10.3`,
  and `@unrs/resolver-binding-wasm32-wasi/node_modules/@emnapi/runtime@1.10.0` (the wasm32 fallback chain).
- **Known evidence limitation (`host.txt`).** `EVIDENCE.sha256` (written by the runner) lists `host.txt` at `19a9af89e5cd10ffcd4127393400a314ee61932d4bbad6c2f7bf03fc7890b154`, taken before `remote-run.sh` appended its last two lines
  (`live sentinel: unchanged`, `finished: …; run-issue314 exit: 0`). The archived `host.txt` minus those two lines hashes to exactly that value; the other 13 listed files match. It is a script-ordering flaw, not a change to the evidence. The original
  archive and the pack were not modified or rebuilt to correct it.
- **Executed bytes = reviewed bytes.** Blob ids of the two executed files, packed and run: `tests/db-promotion-check.test.ts` `2778c347ad6161760e9568afb7a410ca33b77469` (SHA-256 `a20c10090565420466ddc896c280311b8d2902c2d289718a24eed15d6246992c`);
  `tools/db/prepare-promotion-source.ts` `6eeb7936d8edfc9115b99fef0c6b0141bb3a55cc` (SHA-256 `cc78484d1f524f33f697542cd7264460df6cfbe6e487138a27e34f4fe517f47e`). Re-checked by `git hash-object` after the documentation freeze was lifted: both
  unchanged. The five documentation files in the pack are as at the build and are **not** the executed source; this runbook, `CHANGELOG.md`, `IssuesIndex.md` and `issues.md` were edited after the run to record it.
- **Pack and evidence (outside the repository, `D:\tmp\issue314\linux-verify-pack\`; unchanged).** Base `24ca412baa531db75cf5ea3a4839b988f6077993`, tree `80e7d841f20965352fe01263e8bc8571cb389b16`.
  `out\tree.tar` SHA-256 `e55b0d9d936887a8771f0fadf59ade9f28140ee11e2b33efafdfa26a54ce6499` (114,407,424 bytes, 1,864 files, 48 tracked skill/agent files kept as part of the exact tracked base);
  `out\manifest.json` `2a5c4becebffde94481362e996a1da3c353235341fa761b23255be579a377610`; the full `SHA256SUMS` and the seven-file byte manifest are in `BUILD-EVIDENCE.md`.
  Evidence: remote `evidence.tar` (337,920 bytes) SHA-256 `caf6cff6259520479b0eb9f09c3f5e9e3c4d09f495450bd7df71c7c605800e9c`, retrieved by `scp` to `evidence-20261013T015633Z\evidence.tar`, local hash identical to the remote value; extracted at
  `evidence-20261013T015633Z\x\evidence\` (`result.json`, `vitest.json`, `stdout.txt`, `stderr.txt`, `exit.json`, `tree-before.json`, `tree-after.json`, `deps.json`, `live-sentinel-{before,after}.txt`, `host.txt`, `EVIDENCE.sha256`). Full record: `RUN-EVIDENCE-20261013T015633Z.md`.
- **Limits.** Only the 9 ISSUE-314 cases (all DB-free fakes) ran on Linux; the other 456 cases of the file, `tsc`, the `code_test_db` rehearsal and a real `--apply` did not. **No real promotion, `--apply`, rebuild, deployment or DEV/PROD acceptance is claimed.**
  The `cannot be inspected` branch remains untested. The result is not a merge: ISSUE-314 stays **Open** until the implementation and closure records are merged and pushed (§17.5 items 1-4).
