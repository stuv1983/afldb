# Fresh-session execution prompt — packet 6R sitting with Amendment A1 (approved)

Paste everything below the line into a fresh Claude Code session started in `D:\dev\afldb-rem-20261114`, at or shortly before
10:00 AEDT on Wednesday 18 November 2026. The owner approved the A1 block set on 2026-11-16 (`sitting-a1/APPROVAL-A1.md`). This file is
deliberately uncommitted; it goes into the post-sitting records commit.

---

Execute the approved packet 6R sitting (B1, B1a-0 option A, B1a) in the window Wednesday 18 November 2026, 10:00–12:30 AEDT
(17 Nov 23:00 – 18 Nov 01:30 UTC). Do not contact production or DEV before 10:00 AEDT.

## Pins (all must hold; any difference is a STOP)

| Pin | Value |
|---|---|
| Worktree / branch | `D:\dev\afldb-rem-20261114`, `claude/remediation-20261114` |
| Local A1 commit (operational executable artifacts, unpublished) | `HEAD` = `e3d00a91090008a06487bee3330b8e5cd7d53f94`, parent `611630e41f3f27391173615d961c0ab5e1ea7810` |
| Approved block set | `sitting-a1/SHA256SUMS` sha256 = `15aab2e5c46c5339dafdaf171922769185eeeede9a0907afd409019e416b4e66` |
| Remote | `git ls-remote origin refs/heads/main` = `611630e41f3f27391173615d961c0ab5e1ea7810` exactly at P0, P1 and P2 |
| Reviewed delta CP..PREP | raw-listing sha256 `f449aa04346731c1b74cd1d7ca21c3117c16acf83b1598385baaebf84dc30157` (asserted inside P2) |
| Application revision (CP) | `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`; production checkout fast-forwarded to exactly this |
| Typecheck evidence | `f6af6da93551aed9dbd5658319346d7ecdd96ea3` (text in P7) |
| B1a runner | sha256 `bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c`, from commit `15aa89cb` |
| B1a identity | `afldb_prod`, OID 66668, system identifier 7674454702926115004, 2026 id-set MD5 `e5ead8dbf3baf9a7b647b0f55b04c496`, 669 rows |
| Artifact source | `D:\tmp\afldb-b1a-r6r-art-20261118\{prod,dev}` = packet 6R §3 hashes (the values in the P3 and P4 heredocs) |
| Harness evidence | `review/harness-raw-20261116.tgz` sha256 `65f5aad7c89eb033730a9b09e0c5c41a5a0429db64c6714f4959773e041edbb4` |
| Only application rollback target | `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` |

## Sources and approvals

Everything is in `docs/v2/evidence/remediation-20261114/run6r/sitting-a1/` in this worktree. Read:
- `APPROVAL-A1.md` (the owner's verbatim approval of the A1 block set and what it settles: §2);
- `SITTING.md`: §1 approval, §3 transport, §4 sequence, §5 owner-only actions;
- `AMENDMENT-A1.md`: §1 pin, §5.1 operator notes R-9, R-10, R-13, §6.

Packet 6R (`../RELEASE-AND-REPAIR-PACKET-6R.md` §4, §5) governs ordering, preconditions and failure handling. Send only blocks from
`sitting-a1/`, never from `run6r/sitting/`. Do not start another review and do not repeat qualification.

## Command authorisation (this sitting only)

You may run:
- the P0 workstation checks in this worktree (`git rev-parse`, `git status`, `git diff`, `git ls-remote`, `sha256sum`);
- the sitting blocks, exactly as SITTING.md §3 and §4 specify:
  - to production through `C:/Windows/System32/OpenSSH/ssh.exe afldb`;
  - to DEV through `ssh.exe -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`;
- for **P7 and P11 only**, the approved transport-only keepalives `-o ServerAliveInterval=30 -o ServerAliveCountMax=4`;
- the P2b and P3b `scp` transfers and the S9 `curl` smoke;
- at the end, the records commit and the fast-forward publication described below.

You may not:
- run any other production command, or make any other production change;
- use sudo (owner-only actions are in SITTING.md §5: give the owner the exact command and wait);
- reverse or restore the database (no database reversal, no whole-database restore);
- run P6 a second time, under any outcome;
- retry anything automatically;
- publish anything before the sitting's P2 has passed and the sitting has ended.

Use one connection per step, with no rapid reconnects. Leave no wait loops or agents running when you stop.

## P0 (workstation; all must pass before P1)

1. `git rev-parse HEAD` = `e3d00a91090008a06487bee3330b8e5cd7d53f94`; `git diff --quiet HEAD -- docs/v2/evidence/remediation-20261114/run6r/sitting-a1`
   succeeds (the blocks on disk are the committed bytes); `git status --porcelain` shows nothing but this prompt file.
2. `sha256sum sitting-a1/SHA256SUMS` = `15aab2e5c46c5339dafdaf171922769185eeeede9a0907afd409019e416b4e66`, and
   `cd sitting-a1 && sha256sum -c SHA256SUMS` is all 16 OK. Re-check each block's sha256 immediately before sending it.
3. `git ls-remote origin refs/heads/main` = `611630e41f3f27391173615d961c0ab5e1ea7810` exactly. Anything else, including a docs-only
   commit after it: STOP and tell the owner.
4. The artifact source `D:\tmp\afldb-b1a-r6r-art-20261118\{prod,dev}` hashes to the packet 6R §3 values.
5. Fix `STAMP` (UTC `yyyymmddThhmmssZ`) once.

## Rules that differ from, or sharpen, the published sitting

- **P1 settle timer (R-10):** if the `settle next` time P1 prints falls before 12:30 AEDT (01:30 UTC), or otherwise conflicts with the
  window, STOP before P3: no backup, no repair. Tell the owner.
- **P1 and P2** re-check the pin on the host. `STOP unexpected remote drift` at P2 stops the sitting; the owner decides. P2 may be re-run
  once the cause of any other STOP is understood.
- **P5** is `p5-b1a-dryrun.sh STAMP VERDICT-PASS <dump sha256>`. Pass `VERDICT-PASS` and that sha256 only after P4 printed
  `P4 RESULT VERDICT PASS` for that same dump sha256.
- **P6:** continue past P6 only on `P6 RESULT COMMITTED EXACT` with exit 0; then S3 (P7). For every other outcome, including
  `P6 RESULT ATTENTION …` (exit 3), any STOP, and a lost connection: run `r1-state.sh STAMP probe` first (read-only), then apply the
  state-specific procedure in SITTING.md §4 (P6 row) and packet 6R §4.2 exactly. Never retry P6.
- **P7/P11 disconnects:** a dropped connection never establishes command failure and never authorises a retry.
  - P7: the build runs in detached tmux on the host. Do not re-run P7. If P7 printed its `LOG` path, run `p7b-s3-build-check.sh <LOG>`
    (one connection). If it did not, STOP and tell the owner.
  - P11: do not re-run it automatically. Report the ticks received, preserve the output and ask the owner.
- **P9 (R-9):** the operator note does not waive S8 acceptance. If S8's only FAIL is its own `status --expect` line after a `confirm` run
  with S7 PASS, report it as that known status-command limitation, preserve the raw output, and do not roll back on that line alone;
  do not report S8 as PASS. Any other S7/S8 FAIL, and any genuine serving-state failure (unit state, health, S9 smoke, P10, P11), follows
  the existing acceptance and recovery rules (SITTING.md §4, packet 6R §4.3).
- **Harness wording:** if the qualification comes up, it is 98 checks PASS plus 2 explained non-passing lines (APPROVAL-A1.md §3); never
  call it wholly green.

## Stop rules

- Stop on identity drift or any failed prerequisite, and follow the state-specific recovery in SITTING.md §4 and packet 6R §4.
- A release failure does not authorise a database reversal or restore.
- The only application rollback target is `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`; rollback restarts are the owner's.

## After the sitting

1. Make one records commit on top of `e3d00a91` in this worktree. It holds:
   - the results, hashes and outcome (raw outputs preserved);
   - this prompt file;
   - tracker updates per CLAUDE.md §5. Resolve ISSUE-365 only after B1a is committed and re-read on production; D-365-W stays open.
2. Review the complete delta `611630e4..HEAD` (the A1 commit plus the records commit): no path outside `docs/`, `CHANGELOG.md`,
   `IssuesIndex.md` and `issues.md`; no secret, credential, password-bearing DSN or new address. Confirm the A1 commit is still exactly
   `e3d00a91…` and its `SHA256SUMS` still hashes to `15aab2e5…4e66`.
3. Publish by fast-forward only (the owner approved publishing the exact A1 commit and the records documenting this execution).
   Describe `e3d00a91` as **operational executable artifacts**, not records. Verify with `git ls-remote`.
4. Report every file changed and the final `origin/main`.
