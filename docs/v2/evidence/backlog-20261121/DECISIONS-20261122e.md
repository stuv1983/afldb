# Owner decisions of 22 November 2026 (round 4) and backlog run e

**Source.** Owner decisions 1-6 of 2026-11-22 (round 4), relayed to `afldb-orchestrator` by the main session; recorded here in
substance. Run e worked in `D:/dev/afldb-backlog-20261122`, branch `claude/backlog-20261122`, from `8a42bb77` (= run d's tip
`73831da3` plus the main session's fix of runbook §4.5a); `origin/main` = `da4cc0c4`. Local commits only, **no push** (the push is
the main session's, decision 1), no trailers. No `wsl`; no `sudo`; nothing of the owner's deleted; the R0 backup, the five named
databases, arm's real crontab, `/home/arm/afldb-ops` and the preserved workspaces untouched (read-only where read). **Production
contact: exactly one read-only SSH session, for the ISSUE-348 privilege check (§4); nothing else.** Public fetches (Ubuntu, OSV, NVD,
CISA, DigitalOcean documentation) carried public identifiers only. Plan and review: `documentation/plans/PLAN-backlog-20261122e.md`
and `…-REVIEW.md` (plan review before step 1; no CRIT/HIGH; F-001..F-017 applied); returns in `.phaneslight/returns/backlog-20261122e/`.

## 1. Push (decision 1)

The push of this branch is the main session's job, after its review and the owner's approval. Run e pushes nothing.

## 2. R6 APPROVED (decision 2): attended reboot Wed 25 Nov 2026 10:00-11:00 AEDT, fallback 14:00-15:00

Owner rule: **"IF BOOT RECOVERY IS STILL UNCERTAIN, PAUSE BEFORE REBOOTING."** Written: [ATTENDED-PLAN-R6-20261125.md](ATTENDED-PLAN-R6-20261125.md)
with sections (a)-(i) and four read-only scripts in `r6-20261125/` (pre-verify, off-host verify, post-verify `full|grub`, public
smoke), each with its command inventory and a refusal of the dry-run switch on `afldb-prod`; `bash -n` and dry runs on streamanator
(`r6-20261125/dry-run-20261122e.log`; the dry run found and fixed a timer next-elapse bug before commit). The runbook is **NO-GO by
default**; GO needs every named item of its §7 (NG-OWNER, NG-PRE, NG-OFFHOST, NG-CONSOLE, NG-DATA, NG-GRUBREAD, NG-FALLBACK,
NG-TIMERS, NG-APT, NG-TIME). GRUB: option B chosen (temporary `GRUB_DEFAULT=saved` drop-in, saved default 137, one-shot 149 named by
its submenu path; a non-booting 149 becomes a panel power cycle into 137; restored in F5 and verified by script and owner hash); A
(visible menu) and C (rollback-only `grub-reboot`) are record only; Shift/Esc not relied on. DigitalOcean facts are quoted from the
fetched documentation (Recovery Console = VNC, needs the droplet password; Droplet Console = agent, not a recovery path; live
snapshot crash-consistent; restore page 404, so the restore action is located but not documented). **Nothing in R6 has been
rehearsed on a DigitalOcean droplet.** Advisory verification: [r6-20261125/ADVISORY-VERIFICATION.md](r6-20261125/ADVISORY-VERIFICATION.md):
CVE-2026-53266 (fixed 6.8.0-146.146) and CVE-2026-53362 (fixed 6.8.0-147.147) are in CISA KEV (catalogue 2026.11.20, added
2026-09-18 and 2026-08-27), Ubuntu priority high, both fixed in the installed 149 and not in the running 137; Ubuntu tracker, OSV,
NVD, KEV and production's own changelog agree; **run d's README is correct and is not amended.**

## 3. R5 APPROVED (decision 3)

Runbook §4.5a runs in A2 and now adds the owner's re-verify (`sudo sh -c 'cd '"$R"' && sha256sum -c --quiet SHA256SUMS'`) and an
inventory report (names, sizes, owner/mode, file count, `SHA256SUMS` line count); the Caddy size-growth check stays. The 4 Sep access
file is recorded as **ALREADY ROTATED OUT**. **Thu 7 Jan 2027 is the EARLIEST DISPOSAL REVIEW DATE, not a disposal date; disposal
needs a separate approval.** `R5-RETENTION-PROPOSAL.md` gains the decision, the expected exact retained-paths template (§7) and the
review helper `r5-20270107/r5-retained-paths.sh` (sha256 LF `c722a964…71a4`; read-only; transport defined; dry-run on a scratch
directory). §4.5's drop rule and §4.5a's start condition now agree (after R4's probes pass, or on its own at 11:35 if R4 is not
started). The R6 snapshot, if taken, is a provider copy of these files: disposal review also 7 Jan 2027 (OPEN-ITEMS §2).

## 4. ISSUE-348 (decision 4)

The owner's eight = `picks.source_record_id`, `picks.reported_games`, `picks.reported_goals`, `picks.draft_age`, `picks.height_cm`,
`persons.name_key`, `persons.reported_games`, `persons.reported_goals` = **groups (a)-(e)**. Written in
`issue348-acquisition/LOAD-WINDOW-PROPOSAL.md` §2a: the mapping table (letter, column, rows, named by the owner, generator file:line,
linkage effect, covering check); what (f)-(k), `import_batches` (+1, committed `running` at batch open, `completed` with the data) and
`player_link_resolutions` (read, never written) change; detection BEFORE and AFTER COMMIT per group. **Groups with no detection
before COMMIT:** (b), (c), (d), (e), (g), (j), (f) except the 35 protected persons, (k), `import_batches`, `player_link_resolutions`;
after COMMIT all are detected, (k)/`import_batches`/`player_link_resolutions` only by `i348-postload-check.sh` (so it is a required
step). Correction recorded: the reload guard's effect digest refuses **before any write** (before `import_batch` opens), not "during
the write". **Privilege check: PASS** (§2b): static (`pg_read_all_data`, no RLS), indirect (R0 full `pg_dump` as `afldb_backup`),
rehearsal (the check itself on a throwaway PostgreSQL 16.15 cluster with four negative cases), and the one production session
(2026-11-21 21:12:24Z, rc 0, one connection, no retry): SELECT on all nine relations and every column, USAGE on `public`, no RLS,
no write privilege; nothing to fix; production unchanged. Refresh procedure §3a (what Claude re-derives off-host from the nightly
off-host dump, what goes to the owner). **Tue 12 Jan 2027 11:00 AEDT is PROPOSED** everywhere. No load, no re-seal; `sealed/` and
`i348-postload-check.sh` unchanged. **Open owner confirmation:** groups (f)-(k), which the owner has not named (they are inseparable
from a reload of the November pages, §2a).

## 5. R2 (decision 5)

Keep the hourly check; the owner accepts one email per hour while production is unreachable (**F-013 resolved**). Install after the
manual run passes (unchanged), and verify the first scheduled execution, the first `:17` (Melbourne time) after the install, with
`a2-cron-observe.sh r2` (runbook §4.2 step 3). R3's cron approval applies after the first-copy restore passes (§4.3 step 13). Runbook
§4.2/§4.6 and OPEN-ITEMS updated.

## 6. T-1 kept; closure LOW C-F-001 fixed (decision 6)

T-1 and the 10:45 latest-restart rule stay. The R4 start under T-1 is now stated one way, from the §4.5 table: **P6 ends about
10:45-10:48; R4 is scheduled 11:00-11:20, gated on P6 PASS, never started after 11:35; the latest A1 restart is 10:45** (runbook
revision note, §1 text, §1 table; `A1-TIMING-OPTIONS.md` and `DECISIONS-20261122d.md` keep the owner's text verbatim with a dated note
beneath; the fresh-session prompt in commit B).

## 7. Run record

- **Handoff structure (strict):** commit A = all run-e content; commit B (the tip) = only `FRESH-SESSION-PROMPT-A1A2.md`, naming A as
  the REVIEWED COMMIT. Publishing must be a fast-forward of `main` to B; anything else (merge, squash, rebase) breaks the prompt's
  session-start rules, and the prompt is then regenerated as B' on the rebased A'.
- **Production contact:** one session (§4). **streamanator:** workspace `/mnt/ssd/afldb-backlog-20261122e-orch` (0700; dry runs, a
  throwaway PostgreSQL cluster stopped and deleted after the test).
- **Known deviations:** files created with Write, not the PhanesLight `new-file` CLI, and `documentation/plans/_index.md` not
  regenerated (both need Node; the workstation has none), as in runs b-d.
- **Agents:** reviewer plan review (no CRIT/HIGH; MED amendments applied); closure on commit A; a mechanical check of B.
