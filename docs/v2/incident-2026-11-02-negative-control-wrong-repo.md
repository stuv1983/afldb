# Incident 2026-11-02: negative controls ran in the real repository

**Status: RECOVERED AND ACCOUNTED FOR, no content lost, nothing pushed, nothing outside the local repository touched.** Local only; no production, DEV, database or service was involved. Evidence: [`evidence/incident-20261102-negctl-wrong-repo/recovery-evidence.txt`](evidence/incident-20261102-negctl-wrong-repo/recovery-evidence.txt) (read-only Git captured at `f123311d`), the transcript of the session `6e617f9d-dc74-4b5c-ab78-93937e0b6e50` (local, not in Git) and the re-run controls [`m-neg-controls-20261102.log`](evidence/block-m-package-20261102/m-neg-controls-20261102.log).

## 1. What happened

While preparing the Block M static check, a session ran its negative controls in a throw-away clone. The command (2026-11-02 09:50:51 +1100) was one chain:

```
rm -rf $SP/neg && git clone -q --local . $SP/neg && cd $SP/neg && git config user.email t@t && git config user.name t &&
echo "// x" >> src/app/page.tsx 2>/dev/null || echo "// x" >> $(git ls-files 'src/lib/*.ts' | head -1);
git commit -qam "neg: src change" && ... ; git reset -q --hard HEAD~1; echo x >> tools/v2/isolated-pg.ts; git commit -qam ... ; ...
cd /d/dev/afldb; rm -rf $SP/neg
```

`git clone --local` failed on Windows ("failed to create link ... Improper link", hardlinks across the temp directory). Because the later parts were joined with `;` or `||`, the failure skipped only the `&&` links; the `||` fallback and every `;`-separated command then ran **in the real repository** (`D:\dev\afldb`, branch `main`, HEAD `7cf05fc1`). Nothing in the chain asserted the working directory.

## 2. Which real files and refs changed

| When (+1100) | Real-repository effect |
|---|---|
| 09:50:55 | `echo "// x"` appended to `src/lib/acquisition/afl-api-acquisition-constants.ts` (the `||` fallback). `git commit -qam` made **`5a73a4f2`** "neg: src change" on `main`; because of `-a` it also swept in the one pre-existing uncommitted edit, the Block L record correction in `docs/v2/gap-029-block-l-execution-ready-2026-11-02.md` (+11/-1 lines) |
| 09:50:55 | `git reset -q --hard HEAD~1`: `main` back to `7cf05fc1`; the working tree lost the `// x` and **the Block L record edit** (it survived only inside `5a73a4f2`) |
| 09:50:56 and 09:50:57 | `x` appended to `tools/v2/isolated-pg.ts`; commit **`8dd017f9`** "neg: other tool"; hard reset to `7cf05fc1` |
| 09:51:23 and 09:51:24 | `-- ok` appended to `docs/v2/progress.md`; commit **`6dc4fb5e`** "neg: doc only"; hard reset to `7cf05fc1` |
| 09:51:24 | `sed` edited **migration `118_fixtures_unconfirmed_participants.sql`** (two spaces); commit **`75dc444a`** "neg: migration edit"; `main` left at `75dc444a` |
| 09:51 | `m-static-check.sh` (read-only) ran against each of the four commits in the real repository; `rm -rf` of the session's absolute scratchpad path `$SP/neg` (outside the repository) |

Refs: only `refs/heads/main` and `HEAD` moved (reflog: `7cf05fc1 -> 5a73a4f2 -> 7cf05fc1 -> 8dd017f9 -> 7cf05fc1 -> 6dc4fb5e -> 7cf05fc1 -> 75dc444a`). The commits carry the global identity (the `git config` links were skipped). **No push**: the chain contains no `push`, and no remote ref moved. No tag, branch, remote, hook or local-config change exists (`git config --local` holds only the standard `origin` and `main` tracking entries; `.git/hooks` has no non-sample file). The `rm -rf` targets were the absolute scratchpad path of that session only.

## 3. What was recovered, with evidence

At 09:51:31 the session saw `75dc444a` at HEAD, read the reflog (09:51:42) and recovered (09:52:04): `git show 5a73a4f2:<Block L record> > /tmp/...`, `git reset -q --hard 7cf05fc1`, then copied the file back; the working tree then showed ` M <Block L record>` (11 insertions, 1 deletion) and nothing else. It added the "Cause of the stale value" paragraph and committed everything as `88889724` (09:52:42).

Verified now (recovery-evidence sections 3 to 6):

- `git diff 7cf05fc1 5a73a4f2` is exactly two files: the Block L record (+11/-1) and the one-line `// x` in the constants file. The record hunks are the serving-release correction in the current record (section 2: the "Serving" row and the "Correction (2026-11-02, ...)" block).
- `git diff 5a73a4f2 HEAD` on the record has **no removed line**: every recovered line is still present; later changes only add.
- The four touched paths have **identical blob ids** at `7cf05fc1`, at `HEAD` and in the working tree (`afl-api-acquisition-constants.ts` `91356687…`, `isolated-pg.ts` `0fdb9bb4…`, migration 118 `02068b2a…`; `progress.md` unchanged), and none was touched by a later commit.
- Since `7cf05fc1` the only non-`docs/` changes are `CHANGELOG.md` and `IssuesIndex.md`.

## 4. Do migration 118 and every qualified executable input still match?

Yes, by content, not by tree cleanliness.

| Check | Result |
|---|---|
| Migration 118 | sha256 `49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401` at `HEAD` and in the working tree (the approved value) |
| GAP-029 evidence file | LF sha256 `e3848807…430f` (rule C) |
| Block L revision R `86da1a82` | an immutable commit; `git diff --name-only 86da1a82 HEAD` outside `docs/` and root `*.md`: **none**. The production ops checkout is a tar of R, clean at R |
| Qualified candidate E `e0f6c7bc` and type-checked heads `933eb87e`, `bbb52ed4` | all ancestors; `m-static-check.sh` **PASS (A, B, C)** at `HEAD`: nothing outside the allowlist differs since E, nothing but `docs/` and root `*.md` since the type-checked head |
| `m-prod.sh` | sha256 `29ebbdc2…` equals the rehearsed bytes; unchanged since `0bf95bee` |

## 5. Pre-incident uncommitted content that cannot be accounted for

**None in tracked files.** `commit -a` at 09:50:55 recorded every tracked modification then present: `git diff` of `5a73a4f2` against its parent contains exactly the Block L record edit plus the single `// x` control line. Each later control started from the freshly reset tree, so it adds only its own one-line change.

Stated limits (what Git cannot prove): `reset --hard` does not touch untracked or ignored files, and the chain contains no `git clean` or removal of any repository path, so an untracked file was not removed by it; but the absence of a deleted untracked file cannot be proven from Git alone. The untracked set today is `.codex/` (preserved) and this block's new evidence, and the package directories untracked at the time were committed by `88889724` and later.

## 6. Preservation

Nothing was deleted, reset, cleaned or rewritten by the review. The four accidental commits are still reachable from the HEAD reflog and are now additionally pinned by refs (no history is changed):

`refs/recovery/negative-control-incident-20261102/src-change` = `5a73a4f2…`, `…/other-tool` = `8dd017f9…`, `…/doc-only` = `6dc4fb5e…`, `…/migration-edit` = `75dc444a…`. The existing dangling objects from older sessions were left alone.

## 7. Correction made and the rule going forward

The earlier claim in the Block M package ("negative controls, each run against a real commit") described results produced in the wrong repository. Their outputs (a `src/` change fails A and B, another tool fails A and B, docs-only passes, a migration edit fails A, B and C) are reproduced, but the procedure was wrong, so they are **re-run and re-recorded** with a script that cannot reach the real repository:

[`m-neg-controls.sh`](evidence/block-m-package-20261102/m-neg-controls.sh) creates a **new** disposable clone and asserts, before the first mutation: both paths absolute; the disposable path does not exist and is neither inside nor above the real repository; the clone succeeded (`set -euo pipefail`, no `;` chain, no `||` fallback that mutates); the clone's `--show-toplevel` equals the disposable path and its `--absolute-git-dir` equals `<path>/.git`, both different from the real repository's; the check under test is byte-identical to the real one. Every Git mutation uses `git -C "<disposable>"`; controls are branches cut from one base commit; it uses no `reset`, `clean`, `rm` or `commit -a`. It records the real repository's HEAD, branch refs and `status --porcelain` first and **fails if any differs at the end**.

Results ([log](evidence/block-m-package-20261102/m-neg-controls-20261102.log)): **6 of 6** (the four original controls, plus a label-tool edit failing B only and an edit to the GAP-029 evidence file failing C only); real repository unchanged. The first attempt stopped at its own guard ("clone failed; nothing was mutated anywhere", Windows long paths in a deep scratch directory; the clone command now sets `core.longpaths` and the controls used `D:\tmp\nc1102`); that partial clone in the scratch directory and the retained passing clone `D:\tmp\nc1102` are left in place for the owner to remove.

Rule for future work: a scratch-repository step must (1) use an absolute path, (2) assert the scratch repository's toplevel and git directory before any mutation, (3) stop at once if setup fails (`set -e`, no `;` after a setup `&&` chain), and (4) never run `reset --hard` or `commit -a` where the target has not been proven to be the scratch repository.
