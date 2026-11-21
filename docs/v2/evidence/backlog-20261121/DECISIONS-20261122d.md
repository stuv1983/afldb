# Owner decisions of 22 November 2026 (round 3) and backlog run d

**Source.** Owner decisions 1-9 of 2026-11-22 (round 3), relayed to `afldb-orchestrator` by the main session; recorded here verbatim in
substance. Run d worked in `D:/dev/afldb-backlog-20261122`, branch `claude/backlog-20261122` from `origin/main` = `da4cc0c4` (clean
tree). Local commits only, **no push** (the owner's push approval covered only up to `da4cc0c4`), no trailers. No `wsl`; nothing
deleted; the R0 backup, the five named databases and the preserved workspaces untouched; arm's real crontab read only (baseline),
never written. **Production contact: exactly one read-only SSH session for R6 (§4); no `sudo`, no apt update or install.** Plan and
reviewer amendments F-001..F-014: `documentation/plans/PLAN-backlog-20261122d.md` and `…-REVIEW.md` (plan review before step 1; no
CRIT/HIGH; returns in `.phaneslight/returns/backlog-20261122d/`).

## 1. Pin fix (decision 1): DONE

- **PREP** = the `origin/main` tip the owner confirms at the start of the Tuesday session (`da4cc0c459f469d3b1a798302f8fe394962a395f`
  today; if anything is pushed before A1 the owner names the final tip in the first message). PREP must descend from `7d92042f`;
  anything in `7d92042f..PREP` is irrelevant to A1 (A1 builds CAND `7d92042f` by `git archive`); the session records
  `git diff --name-only 7d92042f PREP`. Runbook §0, W0, W1/P2 and the fresh-session prompt updated (`731a5025` was stale).
- `a1-p1-precheck.sh` and `a1-p2-ff.sh`: **header comments only** (no executable line changed; `bash -n` OK on streamanator,
  `a1a2-20261124/dry-tests-20261122d/bash-n.txt`). sha256 (LF): p1 `718d14ec…a146` → `7f4a4bbc984f838375aae8de2dfc09fa0a21c9d312b192ea9db5ab1fdd74d72f`;
  p2 `3f14e4c2…71ff` → `6dc9dc5404cfd6718bd1a087cb5be79eab7db2b49ab89195f190e4c00bf6011a`. Other changed script: `a2-r4-probes.sh`
  (decision 5 verification, §5) → `fa0bf4c401f837b3ad08c70fc179a8fa9bf4e31fc6e8550220657b3038c10a10`. New: `a2-cron-install.sh`
  `53ed83a093dcbdf01f769c35df83df1f2cfb94d25fe84ebced12bae6f18d03c3`, `a2-cron-observe.sh`
  `da505329a58c47fc8275f9b009a9aaf22c206afb246fdbe7dce9e60fb43952a4`. No other A1/A2 script changed.

## 2. A1 timing (decision 2): options written; owner chose T-1 (start 09:20)

[A1-TIMING-OPTIONS.md](A1-TIMING-OPTIONS.md): T-1 (pre-window build from 09:20, restart about 10:08) and T-2 (everything from 10:00,
restart about 10:32-10:38, A2 overruns about 15 minutes), each with a table, the restart, the A2 impact, the 10:45 latest-restart
rule and risks. Recommendation: T-1.

**Owner decision (2026-11-22, written, relayed by the main session after the options were written): T-1 APPROVED**, start **09:20 AEDT on Tue 24 Nov 2026**. The window change is approved: 09:20-09:30 read-only P1 + raw-head baseline; 09:30-09:55 P2 fast-forward of the production checkout to `7d92042f` exactly, P3 build, P3b; 10:00 promote, env, owner restart; A2 starts 10:30, R4 after P6 ends (about 10:45); the latest-restart rule stays 10:45.

**Note (2026-11-22, run e, owner decision 6 of round 4; closure LOW C-F-001).** The text above is the owner's decision, kept
verbatim. Its "R4 after P6 ends (about 10:45)" is stated consistently as: P6 ends about 10:45-10:48; R4 is scheduled
11:00-11:20 (runbook §4.5 table), gated on P6 PASS, never started after 11:35. T-1 and the 10:45 latest-restart rule are unchanged
(10:45 is the restart rule, not the P6 estimate).

## 3. Crons (decision 3): APPROVED with preconditions

- **r2** hourly `17 * * * *` settle check: installed in A2 only after its first manual run succeeds (§4.2 step 3), then a
  cron-environment alarm test (step 4, reviewer F-005). **r3** daily `10 3 * * *` off-host pull: only after the first off-host copy
  is verified (first-copy restore PASS + sidecar, §4.3 step 13); next due Wed 25 Nov 03:10 AEDT.
- `a2-cron-install.sh check|install|remove r2|r3 [--dry-run]`: marker comment + one line, idempotent, refuses duplicates, a short or
  unreadable crontab and a changed pin, 0600 pre-image, byte-for-byte verification with restore on mismatch, next due time in
  Melbourne time. `a2-cron-observe.sh` (read-only) for the first scheduled runs; record place: `OPEN-ITEMS-AFTER-SITTINGS.md` §4.
  `AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh`.
- **Dry test** on streamanator against a stub crontab (`CRONTAB_BIN`), arm's real crontab untouched (sha256 `043d2510…e22e` before and
  after): **54/54 PASS** (`dry-tests-20261122d/t-cron.log`). Staged wrapper verified read-only = `c6467ff4…` (corrected `-T`).
- The 22 Nov email delivery remains separate evidence. Known limit (F-013, LOW): no alarm de-duplication.
- Runbook §4.2, §4.3, §4.5 (time budget, drop order), §4.6 and the fresh-session prompt updated.

## 4. R6/R7 and the kernel (decision 4)

[r6-kernel-check-20261122/README.md](r6-kernel-check-20261122/README.md) (script, redacted raw output, README). **One** read-only
production session, Sun 22 Nov 07:15:05-07:15:09 AEDT, rc 0, no `sudo`, no apt network, no retry.
- **Confirmed:** running `6.8.0-137` up 97 days; `6.8.0-149` installed; reboot pending since 14 Nov (kernels and `libc6`);
  **Livepatch not installed; Ubuntu Pro not attached**; no pending security update in the cached lists; no automatic reboot; GRUB
  hidden/0/0. Production's own 149 changelog lists 2,148 CVE ids newer than 137, of which **two are in CISA KEV** (actively exploited,
  local privilege escalation): CVE-2026-53266 (ebtables SNAT, fixed 146) and CVE-2026-53362 (IPv6 append path, fixed 147).
- **Unknown:** actual reachability of the two on this host (AppArmor unprivileged-userns restriction on, ebtables not loaded, IPv6 on);
  GRUB menu titles (root-only file: an owner `sudo` step); live `pro status`; console access and snapshot settings; whether 149 boots.
- **Verdict: a reboot before the leave is warranted** (the owner decides). Proposed **Wed 25 Nov 2026 10:00-11:00 AEDT** (fallback
  14:00-15:00), after the first scheduled backup, pull and verification, with the prerequisites the owner listed (console verified,
  snapshot or verified backup, R1 installed, settle timer stopped first and restarted after, GRUB rollback to 137, acceptance
  probes, owner present). If not: triggers and alternate-operator prerequisites in README §4.2 (no person named).
- **R7:** the five databases stay pending a separate disposal decision; earliest an attended sitting on or after Thu 7 Jan 2027 (§5).

## 5. R5 (decision 5): retain with restricted access

[R5-RETENTION-PROPOSAL.md](R5-RETENTION-PROPOSAL.md): exact scope from records (8 rolled pre-fix files + 2 live files; the 4 Sep access
file already pruned by Caddy between 14 and 22 Nov), token routes and lifetimes, current access, two expiry options (on/after Thu 7 Jan
2027; on/after Mon 22 Feb 2027) with trade-offs, not decided. A2 §4.5a: the metadata listing with expected values and one owner `sudo`
block moving the rolled files into `/var/log/afldb-r5-prefix-retained-20261124/` (`root:root 0700`), with the rollback. **Finding
(MED, handled):** "retain" without a step would lose more files to Caddy's own rotation during the leave. R4 material verified:
`a2-r4-probes.sh` now also probes the magic-link (`/beta/verify?token=`) and the `Referer` shapes, with a count-only owner check;
the R4 rollback is stated in §4.4.

## 6. ISSUE-348 (decision 6)

[LOAD-WINDOW-PROPOSAL.md](issue348-acquisition/LOAD-WINDOW-PROPOSAL.md): every sealed digest quoted in full and recomputed (all equal,
including the transfer tar on streamanator); which digest covers which F-2 group (the reload guard's effect digest covers only
deletions, protected-row rewrites and origin changes; the re-baseline groups are protected before COMMIT only by pinned inputs plus
the start-state digest and determinism, and checked by `digest post` after COMMIT; `import_batches` and `player_link_resolutions` are
in no sealed digest). Smallest addition: a read-only post-load check outside the seal (no re-seal). Window recommendation: from Thu
7 Jan 2027 (proposed Tue 12 Jan 2027 11:00 AEDT), accepting a probable re-rehearsal (F-008). **Open owner confirmation:** the owner's
message says "the eight F-2 groups"; `F2-DECISION-REVIEW.md` §2 has eleven lettered groups (a)-(k). The approval text names (a)-(k).

## 7. ISSUE-373 (decision 7): RESOLVED as an accepted residual

[ACCEPTED-RESIDUAL-118.md](issue373-gc-investigation/ACCEPTED-RESIDUAL-118.md) lists the 78 deferrals and the 40 brother disagreements
by board and cell; 118 findings over 113 cells (five brother cells carry a Lyons and a Webster finding). G-a and G-b PASS; G-c has 118
ACCEPTED findings; any other finding needs its own explanation. No test or gate change. `issues.md` entry resolved, Open Issues row and
`IssuesIndex.md` entry removed, ISSUE-363 follow-up references updated; `CHANGELOG.md` **updated** (a retained validation state changed).

## 8. R8 (decision 8): draft APPROVED

`R8-OPENING-PLAN-2027-DRAFT.md`: the draft approval recorded (§6); capture and read-only planning **Fri 19 Feb 2027** (weekday verified;
no other record claims the date); revision rule (R = what production serves after A1 = `7d92042f` unless a later release); pins and blob
digests that exist now; expected writes; the final plan digest exists only after the 19 Feb capture; what the owner approves (digest,
writes, revision, window).

## 9. Trackers (decision 9)

`OPEN-ITEMS-AFTER-SITTINGS.md` rewritten for run d; `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` synchronised (§10).

## 10. Run record

- **Commits (local, branch `claude/backlog-20261122`, no push, no trailers):** `4c81a78e` (A1/A2 runbook, cron scripts, PREP, R5 block,
  timing options), `fce8ca85` (373 appendix, CHANGELOG, R8, R5 proposal), `a5e21eda` (ISSUE-348 load-window proposal and post-load
  check), `52961997` (T-1 decision), and the final tracker/R6 commit that carries this file.
- **Agents:** reviewer plan review (no CRIT/HIGH; F-001..F-014 applied); one worker (ISSUE-348 post-load check, dry run 146/146 x3,
  six negatives fail); closure verification after the commits. Returns: `.phaneslight/returns/backlog-20261122d/`.
- **streamanator workspaces created by run d (kept, small):** `/mnt/ssd/afldb-backlog-20261122d-r6` (rehearsal outputs),
  `/mnt/ssd/afldb-backlog-20261122d-cron` (cron dry test, `bash -n` copies), `/mnt/ssd/afldb-backlog-20261122d-348` (72K: script and log;
  the copied cluster was deleted). The 22b-348 workspace was read only (listing hash identical before and after).
- **Not verified:** the cron jobs on the real crontab (installed only in A2); the post-load check's production path; the R4 probes
  and the R5 block on production (A2); GRUB titles, console and snapshot settings (owner); the reachability of the two KEV CVEs.
