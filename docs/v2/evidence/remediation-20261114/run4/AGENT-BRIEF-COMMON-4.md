# Remediation run 4 — common brief (binding for every run-4 agent)

`../AGENT-PROTOCOL.md` applies, with `../run3/AGENT-BRIEF-COMMON-3.md`'s workspace, classification and discipline rules, changed as below.
Where they differ, **this file wins**. Plan: `RUN-PLAN-4.md`; plan review: `PLAN-REVIEW-4.md` (its MED mitigations are binding).

## 1. Hard stops (owner, 2026-11-15) — any breach: stop and disclose
- **No** `git push`, merge to origin, PR or publication of any kind. Read-only `git fetch`/`ls-remote` against origin is allowed.
- **No production contact at all** (no ssh/scp to production, not even the read-only B0 probe). No B0–B8 step.
- **No DEV application operation:** never touch `afldb.service`, `postgresql@16-main`, `caddy`, port 5432, `/home/arm/projects/afldb`
  (except read-only copying of named, hash-verified inputs, where your brief says so), `/home/arm/afldb-*` (read-only named inputs only).
  DEV stays at `8b024098`.
- **No live Brownlow state** anywhere except your own isolated databases. No host-policy install, no `sudo`, no `wsl` command, no log deletion.
- **Lint allowance:** `tools/dev/lint-baseline.json` may not be expanded or edited to absorb an error (338 errors / 43 files may only go down).
  Never silence lint mechanically.
- **Never rebuild, connect to or write the shared `afldb_test`** (port 5432).
- **RB-1 is protected:** never write, move, rename, `chmod`, delete or clean anything under `/mnt/ssd/afldb-i316-rb-I-20261023T0905Z` **or**
  `/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z` (the first is a symlink to the second). They are excluded from every cleanup.
  Read-only hashing/copying of named inputs only if your brief explicitly grants it (only the `qual` brief may, and only if a rebuild is required).
- ISSUE-331 stores (`D:\tmp\afldb-v2-pg16`, `D:\afldb-retained\…`) and `D:\dev\afldb` (the owner's uncommitted work) are never touched.
- Never accept an owner decision or residual on the owner's behalf. The run-4 decisions D-365-1, 363-W, 363-G, 363-C, 363-B, 363-3, RB-1
  ARE approved by the owner for local implementation and qualification; nothing else is.

## 2. Workspaces (yours only)
- Worktree `D:\dev\afldb-rem4-<scope>`, branch `claude/rem4-<scope>-20261115`, base **B4** (the commit that added this file; the orchestrator
  created the worktree for you). Commit only on your branch. `git -c core.longpaths=true` on the workstation. Never edit another worktree.
- Workstation scratch: `D:\tmp\afldb-rem4-<scope>\` only. Scripts you run on the host: write them there (LF, Write tool), `scp` them.
- Host `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100` (the `streamanator` alias is broken; from PowerShell use `$HOME\.ssh\afldb_dev`).
  Workspace `W=/mnt/ssd/afldb-rem4-<scope>-20261115`, cluster root `/mnt/ssd/afldb-rem4-<scope>-20261115-pg`, **your port only**.
  Databases `afldb_v2_rem4<scope>*_test`, or `afldb_v2_rb_rem4<scope>*_test` only where a suite requires the rebuild-name pattern.
  Always export `AFLDB_V2_PG_ROOT`, `AFLDB_V2_PG_PORT`, `AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin` (never ports 5432, 55432, 55651, 55660,
  or 55671–55678 which belong to run-3 workspaces).
- Host checkout: `git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand $W/cand && cd $W/cand &&
  git fetch -q /mnt/ssd/afldb-rem4-base/base-B4.bundle claude/remediation-20261114:refs/heads/base && git checkout -q base &&
  git rev-parse HEAD` (must print B4's full SHA, stated in your scope brief; verify the bundle sha256 in `/mnt/ssd/afldb-rem4-base/SHA256SUMS`
  first), then `npm ci --no-audit --no-fund`. **No `.env`** in the workspace. Transfer your commits with a bundle `B4..claude/rem4-<scope>-20261115`.
  Final evidence must come from a host checkout whose `HEAD` equals your final commit with an empty `git status --porcelain` (record both).
- Node `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`; `export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=$PYTHON`.
- Every vitest or tool invocation touching a database: `node --import tsx tools/v2/isolated-pg.ts run <db> -- node node_modules/vitest/vitest.mjs run …`
  (never `npm`/`npx` inside `run`). `isolated-pg run` strips ambient DSNs.
- **Bases (read-only inputs; verify before use, a fresh `create-db --template` copy per experiment, never reuse a mutated copy):**
  - *Accepted rebuild:* `/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump`, sha256
    `d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63`; restore exactly per `/mnt/ssd/afldb-rem3-base/rebuilt/RESTORE.md`
    (`IR roles` first; `restore-dump.mjs`; `IR verify`; 83-table count diff against `table-counts.tsv` must be empty). Bridge child
    `afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json` (sha256 `1200e702…b9d`) when a suite needs it.
  - *4 Nov snapshot:* `/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump`, 30,141,895 bytes, sha256
    `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d` (verify both); restore with
    `/mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs`; ledger 118. Production-derived: never copy it or row extracts off the host; aggregates only.
- **Heavy lock:** restores, full-suite runs, typecheck, builds and any multi-file vitest group take `flock /mnt/ssd/afldb-rem4-base/heavy.lock`
  (single-file focused runs may skip it). Anything > ~8 min: detached (`setsid nohup … &`, record PID), poll with short bounded ssh calls. Every host
  command bounded with `timeout`. Under `pipefail` use `grep PAT >/dev/null`, never `grep -q`. Never `pkill -f` a pattern that can match your own shell.

## 3. Test design rules (binding)
- **No test may compute its expected value with the implementation under test.** Expected values are literals with recorded provenance, or come
  from an *independent* oracle (raw-table SQL written in the test that does not call or copy the function under test, or a committed source file
  with a recorded hash). State the provenance of every new or changed expected value in a comment and in your README.
- Assertions about "history" use **stable keys** (club `slug`/identity key, player external/stable identity, never a surrogate `id` that differs
  between bases) and an **explicit season bound** where the fact is historical (owner 363-W: through 2025).
- No test may assume that the current calendar year has an open season (owner 363-G): use a controlled, suite-owned fixture or a season the test
  itself establishes as in progress.
- Fixtures that a suite creates, mutates or cleans up use **suite-owned identifiers** (synthetic provider ids, own seasons/clubs/dates in the
  suite's documented range); a real provider id (e.g. `CD_I297354`) may remain only in genuinely read-only historical assertions.
  Cleanup deletes only rows the suite created (by owned key), never a pre-existing row; restore what you captured.
- Red/green: every fix or new assertion is shown **red on the unfixed code with the exact failure text** and green after, on the base(s) it
  claims. A red that fails for a fixture/environment reason proves nothing. Never weaken, skip, `todo` or delete a useful assertion.
- Extend the closest existing suite (CLAUDE.md §10). A new file under `src/`, `tests/` or `documentation/` only via
  `node .phaneslight/scripts/cli.js new-file <module> <path> "<≥5-word description>"`, and only if no existing suite is a sensible home.
- Frozen pins stay frozen unless your scope brief names the owner decision that unfreezes one (`DRAFTGURU_EXPECTED` 6,810/5,057,
  `draftguru-contract.json`, `EXPECT_STAGE_A_EVENTS`, linkage SQL, labels, `AWARDS_HONOURS_EXPECTED`, the ladder witness tuple, the accepted-baseline
  register). 363-C unfreezes the Coleman contract's row expectation **only** for the `coleman276` scope; 363-B the birth-date pins **only** for `gates`.

## 4. Classification vocabulary (every failing integration id gets exactly one)
1 passes under intended conditions (environment-only failure before); 2 actual defect (fixed with red/green, or reported if out of scope);
3 stale assertion (with evidence the oracle value is wrong; before/after recorded; never a frozen pin); 4 deliberate refusal (by design; condition
named); 5 limitation awaiting the owner; 6 not run / blocked (exact stage or missing input). "It also failed in run 3" is continuity, never a reason.

## 5. Process discipline
- Never edit `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, `HANDOFF.md`, or any run-1/2/3 evidence file.
  Your record: `docs/v2/evidence/remediation-20261114/run4/<scope>/README.md` plus small raw files (`git add -f` for `*.log`; gzip large JSON),
  with a `SHA256SUMS` of the committed raw files; check each committed copy with `git cat-file blob HEAD:<path> | sha256sum`.
- `CLAUDE.md` §8/§10/§11 and the Next.js 16 warning apply. Read current docs before changing a modelling rule.
- Commits: small, subject `ISSUE-NNN: <what>`, body what/why, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your own
  model name). No `--no-verify`, no amend after reporting.
- Escalate MED and above outside your scope to the orchestrator in your final report; do not fix it. A finding inside scope that needs an owner
  decision: prepare options + recommendation, continue all independent work.
- Before your final report: `isolated-pg stop`, prove no listener on your port, `pgrep -u arm -af $W` empty, `du -sh $W`. Leave the workspace.
- Final report: `../AGENT-PROTOCOL.md` §8 items 1–7, plus final commit SHA, host checkout SHA + clean porcelain, cluster stopped, an exhaustive
  `edits_made` list (repository and outside), every incident (anything outside authority, any orphan process/database/file) disclosed.
