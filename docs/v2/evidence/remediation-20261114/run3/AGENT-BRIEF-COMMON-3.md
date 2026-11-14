# Remediation run 3 — common brief (binding for every run-3 scope agent)

`../AGENT-PROTOCOL.md` and `../run2/AGENT-BRIEF-COMMON.md` apply, with these changes. Where they differ, this file wins.
Plan review: `PLAN-REVIEW-3.md` (PROCEED, 0 CRIT/HIGH; its eight MED mitigations are folded in below and are binding).

## Workspaces (yours only)
- Worktree `D:\dev\afldb-rem3-<scope>`, branch `claude/rem3-<scope>-20261114`, base **`6d5388ea`** (run-2 candidate tip;
  executable revision Q = `f10e47ad`). Commit only on your branch. Never edit `D:\dev\afldb`, `D:\dev\afldb-rem-20261114`
  or another scope's worktree. Use `git -c core.longpaths=true` on the workstation.
- Workstation scratch: `D:\tmp\afldb-rem3-<scope>\` only. Scripts you run on the host are ones you wrote there (LF, Write tool)
  and copied to your host workspace.
- Host: `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100` (the `streamanator` alias is broken); `scp` the same key.
  Workspace `W=/mnt/ssd/afldb-rem3-<scope>-20261114`, cluster root `W-pg` = `/mnt/ssd/afldb-rem3-<scope>-20261114-pg`,
  **your port only** (brief). Databases `afldb_v2_rem3<scope>*_test`, or `afldb_v2_rb_rem3*_test` where a rebuild name is
  required. **Always** export `AFLDB_V2_PG_ROOT`, `AFLDB_V2_PG_PORT`, `AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin`
  explicitly (the tool's default port 55432 has incident history; never 5432, 55432, 55651, 55660).
- Host checkout: `git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand $W/cand && cd $W/cand &&
  git fetch -q /mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle claude/remediation-20261114:refs/heads/base &&
  git checkout -q base && git rev-parse HEAD` (must print `6d5388ea5305e73b0420fbccfa7b0cea4fe75927`; bundle sha256
  `0a1b46d187a4173cef5bef0833fb8ad621d58116dcd5c4026b4dc494f9ccbf68`), then `npm ci --no-audit --no-fund`.
  The workspace must contain **no `.env`** (rebuild-test and others load `.env` from the working directory).
  Transfer your commits with a bundle `6d5388ea..claude/rem3-<scope>-20261114`.
- Node `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`; Python `PYTHON=AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python`.
- **Every vitest or tool invocation that touches a database runs through `isolated-pg run <db> -- node node_modules/...`**
  (never `npm`/`npx` inside `run`), including shared-mode proofs. `isolated-pg run` strips ambient DSNs.
- Snapshot template (read only): `/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump`,
  30141895 bytes, sha256 `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d` — verify both before use; restore with
  `/mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs` as run 2 did; ledger must be 118. A fresh `--template` copy per experiment.
- Heavy phases (restore, rebuild, full-suite runs, build) take `flock /mnt/ssd/afldb-rem3-base/heavy.lock`.
  Anything > ~8 minutes: launch detached (`setsid nohup … &`, record the PID), poll with short bounded ssh calls.
  Every host command bounded with `timeout`. Under `pipefail` use `grep PAT >/dev/null`, never `grep -q`.

## Authority (owner, 2026-11-14, per task)
Allowed: local commits on your branch, tests, builds where your brief allows, isolated clusters in your workspace,
read-only copying of named hash-verified inputs from the DEV checkout data (`/home/arm/projects/afldb/data/...`) and
retained workspaces into your own workspace, read-only `git fetch`/`ls-remote` against origin.
**Forbidden:** push/merge to origin; **any** contact with the production host (no ssh/scp, not even read-only); any DEV
mutation (DEV app/services/DB/port 5432/`/home/arm/projects/afldb` writes, `/home/arm/afldb-*`); the shared `afldb_test` on
:5432; production or DEV credentials/DSNs; `sudo`; any `wsl` command; ISSUE-331 stores (`D:\tmp\afldb-v2-pg16`,
`D:\afldb-retained\…`); other host workspaces except read-only named inputs; accepting any owner decision or residual.

## Data-contract pin freeze (binding)
Do not change, to obtain a pass: `DRAFTGURU_EXPECTED` (6,810 picks / 5,057 persons), `draftguru-contract.json`,
`EXPECT_STAGE_A_EVENTS`, linkage SQL, labels, the Coleman contract, `AWARDS_HONOURS_EXPECTED`, the ladder witness tuple, any
accepted-baseline register, or any other modelling pin. A suspected stale modelling pin is reported as an **owner
decision** with evidence, never edited. The frozen DraftGuru baseline (6,810) is distinct from production's 35 audited
D-336-2 inserts (ids 6819–6853), which belong to production only.

## Classification vocabulary (every integration id gets exactly one)
1. **passes under intended conditions** (environment-only failure before);
2. **actual defect** (test, harness or app) — fixed with red/green, or reported if outside scope;
3. **stale assertion** — only with evidence the oracle value is wrong; before/after values recorded; never a modelling pin;
4. **deliberate refusal** (the suite refuses by design; condition not reproducible from its documented recipe and retained artefacts);
5. **limitation awaiting owner**;
6. **not run / blocked** (exact stage or missing input named).
"It also failed earlier" is never a reason. Hand-deleting rows or assembling a clone to satisfy a guard is manufacturing the
condition: only the suite's documented recipe from retained artefacts counts; record the base and every preparatory statement.

## Process discipline
- Never edit `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, HANDOFF, any run-1/run-2
  evidence file. Your record: `docs/v2/evidence/remediation-20261114/run3/<scope>/README.md` plus small raw files
  (`git add -f` for `*.log`), with a `SHA256SUMS` of the committed raw files; check each committed copy with
  `git cat-file blob HEAD:<path> | sha256sum`. Never copy production-derived dumps or row extracts into the repo; aggregates,
  ids and counts only. Keep raw vitest JSON verdicts (gzip if large).
- Before your final report: `isolated-pg stop`, prove no listener on your port, `pgrep -u arm -af $W` empty, `du -sh $W`.
  Leave the workspace in place.
- Focused regression in the closest existing suite, red on unfixed code with the exact failure text, green after. Never weaken,
  skip or delete useful tests or silence lint. Escalate MED+ outside your scope; do not fix it.
- Final report: AGENT-PROTOCOL §8 items 1–7, plus final commit SHA, host checkout SHA + clean porcelain, clusters stopped,
  and the exact `edits_made` list. Any incident (anything touched outside authority, any orphan) disclosed.
