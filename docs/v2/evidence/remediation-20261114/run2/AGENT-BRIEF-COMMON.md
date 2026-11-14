# Remediation run 2 — common brief (binding for every scope agent)

`../AGENT-PROTOCOL.md` applies in full, with these changes. Where they differ, this file wins.

## Workspaces (yours only; never another scope's)
- Worktree `D:\dev\afldb-rem2-<scope>`, branch `claude/rem2-<scope>-20261114`, base **`e8666c17`** (the run-1 candidate tip).
  Commit only on your branch. Never edit `D:\dev\afldb`, `D:\dev\afldb-rem-20261114` or any other worktree.
- Workstation scratch: `D:\tmp\afldb-rem2-<scope>\` only. Never the session scratchpad, never another scope's directory.
  Every script you run on the host is one you wrote into your own scratch and copied to your own host workspace.
- Host workspace `W=/mnt/ssd/afldb-rem2-<scope>-20261114`, your port, databases `afldb_v2_rem2<scope>*_test` only.
- Host checkout of the base: `git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand $W/cand && cd $W/cand &&
  git fetch -q /mnt/ssd/afldb-rem2-base/base-e8666c17.bundle claude/remediation-20261114:refs/heads/base &&
  git checkout -q base && git rev-parse HEAD` (must print `e8666c17…`; bundle sha256
  `02940af6d3065abae2e0cd42f8ca6384462a42350a293401b368d0db2453d44a`), then `npm ci --no-audit --no-fund`.
  Transfer your commits with a bundle `e8666c17..claude/rem2-<scope>-20261114`. Final qualification on a checkout whose
  HEAD equals your final commit with an empty `git status --porcelain` (record both).
- Snapshot template: as AGENT-PROTOCOL §4 (verify size and sha256 first; ledger 118; fresh `--template` copy per experiment).

## Authority
Local implementation and qualification only (AGENT-PROTOCOL §2). **Forbidden:** push, merge, deploy, install, restart,
reboot, any configuration change on a real host, any production or DEV write, `sudo`, `wsl`, deleting logs, touching
ISSUE-331 stores (`D:\tmp\afldb-v2-pg16`, `D:\afldb-retained\…`), DEV services/ports/paths, other host workspaces
(read-only use of a named input only), `/mnt/ssd/afldb/records` except read-only named inputs.
Read-only production checks only if your brief says so, exactly per AGENT-PROTOCOL §6.

## Process discipline
- Every host command bounded: `timeout <s>` on anything that could hang; background jobs only with a recorded PID you
  later prove gone. Before your final report: `isolated-pg stop`, prove no listener on your port, no process of yours
  left (`pgrep -u arm -af <your W>` empty), `du -sh $W`. Leave the workspace in place.
- Do not edit `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`,
  `HANDOFF.md`, `QUALIFICATION.md`, `APPROVAL-PACKET.md`, or any existing evidence file. Your record:
  `docs/v2/evidence/remediation-20261114/run2/<scope>/README.md` (+ small raw files; `git add -f` kept logs).
  Hash raw outputs you keep on the host into a manifest in your directory, and check each committed copy against it
  with `git cat-file blob HEAD:<path> | sha256sum` before you report (CR bytes: see `run2/<scope>` of `evidence`;
  store raw logs as committed `-text` only if your scope owns `.gitattributes` — only `evidence` does; otherwise commit a
  `.txt` copy and state that the committed copy is LF-normalised if the raw had CRs).
- Tests: focused regression in the closest existing suite, red on the unfixed code with the exact failure text, green
  after. Never weaken/skip/delete useful tests or silence lint. Automated verdicts and manual assessment kept apart.
- "Accepted LOW" by an agent is not owner acceptance. A residual you leave: consequence, existing protection, operator
  action, alternatives, recommended disposition.
- Out-of-scope MED+ defects: report, do not fix. Owner decisions: options + recommendation + exact change; keep going.

## Final report
AGENT-PROTOCOL §8 items 1–7, plus: final commit SHA, host checkout SHA + clean status, every process/cluster stopped.
