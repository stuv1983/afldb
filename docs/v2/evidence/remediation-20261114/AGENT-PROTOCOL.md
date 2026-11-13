# Remediation run 2026-11-14 — agent protocol (binding for every agent of this run)

Owner instruction (2026-11-14): act on the full review recorded at `5035ed96` (branch `claude/review-full-20261114`);
implement and qualify local fixes for ISSUE-348 and ISSUE-350–364; prepare ISSUE-332 without crossing its dated gates.
The main session is the orchestrator: it owns issue numbering, integration, `issues.md`, `IssuesIndex.md`,
`blockers.md`, `CHANGELOG.md` and the final approval packet. You own one scope.

## 1. Sources (read narrowly)
- Review report: `issues/reviews/AFLDB-FULL-REVIEW-2026-11-14.md` (your section only, plus §2–§3 if relevant).
- Issue entries: `issues.md`, search `^## AFLDB-ISSUE-<n>` (read only your entries).
- Review evidence: `docs/v2/evidence/full-review-20261114/` (baseline logs, `live-checks/RESULTS.md`).
- Review host workspace (read-only for you): streamanator `/mnt/ssd/afldb-review-20261114T0640Z/`
  (`in/review-host.sh`, `in/restore.mjs`, `in/probe-dbs.mjs`, `agents/<admin|search|ingest|frontend|auth|ops|tests>/evidence/`).
- `CLAUDE.md` §3 (read discipline), §8 (NL), §10 (tests), §11 (data rules). The Next.js in this repo is 16.x: before
  writing Next code read the relevant guide under `node_modules/next/dist/docs/` (on the host checkout).
- The validated review is **not infallible**: validate each finding before changing code; amend or reject it with
  evidence where warranted, and say so in your report.

## 2. Authority and hard limits
Allowed: shell, Git inspection, local commits on YOUR branch only, transfers to streamanator, tests, typecheck,
build (only if your brief says so), Playwright, guarded database rehearsals in YOUR disposable workspace.
Forbidden: push, merge, rebase or commit on any other branch; deploy; restart/reboot; any change to live configuration;
production backups; any write to a production or DEV database; `sudo`; any `wsl` command; touching ISSUE-331 quarantined
stores (`D:\tmp\afldb-v2-pg16`, `D:\afldb-retained\…`); editing `D:\dev\afldb` (it holds unrelated uncommitted work) or
any other worktree than yours. Read-only production/DEV checks only if your brief grants them (§6).

Do NOT edit `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md` or any
`issues/closed/*` / existing evidence file. Historical evidence and runbooks are preserved; add errata files beside them
if needed. Your durable record goes in `docs/v2/evidence/remediation-20261114/<scope>/README.md` (plus small raw files;
`*.log` is gitignored, so `git add -f` logs you keep, or use `.txt`). Large raw output stays on the host with a sha256
recorded in the README. Never copy production-derived dumps or row extracts into the repo or the workstation; aggregates,
ids and counts only.

## 3. Local worktree and commits
- Work only in `D:\dev\afldb-rem-<scope>` on branch `claude/rem-<scope>-20261114` (base `5035ed96` = GitHub
  `origin/main` `de640826` + review records). Files are LF (`.gitattributes`); write scripts with the Write tool.
- The workstation has no Node, so all execution happens on the host. Git Bash and PowerShell exist.
- Commit in small reviewed commits, subject `ISSUE-NNN: <what>`; body says what and why; end with the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No `--no-verify`. Never amend a commit after you have
  reported it.
- Disclose every edit in your report (file list per commit). An undisclosed edit is drift.

## 4. Host workspace (streamanator, DEV host)
- SSH from PowerShell: `ssh -o BatchMode=yes -i $HOME\.ssh\afldb_dev arm@10.0.40.100 '<cmd>'`; `scp -i $HOME\.ssh\afldb_dev`.
  PowerShell strips inner quotes: for anything non-trivial write an LF script locally, `scp` it, run it by path.
- Workspace `W=/mnt/ssd/afldb-rem-<scope>-20261114`. Your loopback port is in your brief. Cluster root `$W/pg-root`.
  Databases: `afldb_v2_rem<scope>*_test` only (`isolated-pg` requires `_test`).
- Node: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. Python: `export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=$PYTHON`.
- Isolated cluster: `export AFLDB_V2_PG_ROOT=$W/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=<port>`;
  `node --import tsx tools/v2/isolated-pg.ts init|start|roles|status|create-db <db> [--template <t>]|run <db> -- <cmd>|stop`
  (run from the checkout). Follow `in/review-host.sh` functions `p4_cluster`, `p5_template`, `listener_is_ours`.
- Template from the approved restore-verified production snapshot (read only, never copy elsewhere):
  `/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump`,
  sha256 `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d`, 30141895 bytes; verify both before use;
  restore with `in/restore.mjs`; ledger must be 118. Make a fresh `--template` copy per experiment.
  Some suites are pinned to a rebuilt `afldb_test`, not to this snapshot: classify such failures, never relabel them.
- Checkout: `git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand $W/cand && cd $W/cand && git checkout -q --detach de640826d13489c58392563e7ae1ff62403ed293 && npm ci --no-audit --no-fund`.
  Transfer your commits with a bundle: workstation `git -C D:\dev\afldb-rem-<scope> bundle create <scratch>\<scope>.bundle de640826..HEAD`,
  `scp` to `$W/`, host `git -C $W/cand fetch -q $W/<scope>.bundle HEAD:refs/heads/rem-<n> && git -C $W/cand checkout -q rem-<n>`.
  While iterating you may `scp` single files into `$W/cand`; the **final qualification must run on a checkout whose
  `git rev-parse HEAD` equals your final local commit and whose `git status --porcelain` is empty** (record both).
- Never touch the DEV service (`afldb.service`, `postgresql@16-main`, port 5432, `/home/arm/projects/afldb`,
  `/home/arm/afldb-*`), other workspaces, or `/mnt/ssd/afldb/records` (read-only use of named inputs only).
- ~11 agents share this host (24 cores, 31 GB). Run focused files, not the whole integration suite. Do not run
  `next build` unless your brief allows it. If a test times out, rerun that file alone before classifying it.
- At the end: `isolated-pg stop`, prove no listener on your port, record `du -sh $W`. Leave the workspace in place.

## 5. Test and evidence discipline
- Every fix: a focused regression test in the closest existing suite (CLAUDE.md §10 table); **red on the unfixed code
  with the exact expected failure text, green after**. A red that fails for a fixture reason proves nothing.
- Never weaken, skip or delete useful tests, never mechanically silence lint, never treat NULL as zero, never truncate
  tied holders, keep stable ids, historical club identity, source ownership, audits and seals.
- Diagnose environmental/fixture failures; never count them as passes. Keep automated verdicts separate from manual
  assessment. Preserve raw results (host paths + sha256).
- Graph tooling: `codebase-memory-mcp` is not connected this session; use `semble` (if available) or Grep/Read and say so.

## 6. Read-only production/DEV checks (only if your brief grants them)
Pattern: `docs/v2/evidence/full-review-20261114/live-checks/` (`prod-ro-*.sh`): production via PowerShell `ssh afldb`,
one session per script, no `sudo`, DSN read on the host and never printed, `default_transaction_read_only`,
`REPEATABLE READ READ ONLY`, `TimeZone=Etc/UTC`, assert identity (`afldb_prod`, OID 66668, sysid
`7674454702926115004`, `transaction_read_only = on`) before any read, aggregates only. `release.mjs status` only
without `--expect`. `systemctl show/status/list-timers/cat`, reading world-readable `/etc` files: allowed. Anything
that could change state: forbidden. Save scripts and results under your evidence directory.

## 7. Escalation and decisions
Out-of-scope defects at MED or above: report, don't fix. A decision that is genuinely the owner's: prepare the options
with a recommendation and exact proposed change, then continue all independent work. Do not stop to ask.

## 8. Final report (your last message; the orchestrator verifies it against source and evidence)
1. Per finding: validated / amended / rejected, with evidence (`file:line`, command, result).
2. Commits in order: SHA, subject, files.
3. Tests: exact commands, red result (failure text) and green result (counts), checkout SHA and clean status, host
   evidence paths and hashes.
4. Remaining failures, classified; coverage gaps; anything not run and why.
5. Owner decisions needed: options, recommendation, exact proposed change, execution/recovery procedure.
6. Proposed ledger text per issue (Status / Fix / Validation / Next action — concise, factual, local-only state)
   and proposed `CHANGELOG.md` Unreleased lines.
7. Every file you changed. Host workspace path, port, cluster stopped (yes/no).
