# What stays open after each sitting, and the evidence each issue still needs (prepared 22 Nov 2026, run c; revised runs d and e)

**CURRENT — Sunday review amendment, 22 November 2026.** Seven open issues: **332, 348, 350, 351, 352, 357, 362**.
**Before Monday 23 Nov 03:10 AEDT:** owner installation of the new wrapper and verifier is required; see the
[amended R6 runbook](ATTENDED-PLAN-R6-20261125.md) and
[repair/test evidence](sunday-review-20261122/README.md).
A1/A2 ran Sunday; 371/372 remain resolved under the recorded narrow waiver. Monday pull, Wednesday verification
and reboot remain pending. PREP `ae51cd8d913a7523dd89fb638279e7f910054b79` remains the historical Sunday contract.

| Issue | Current action (22 Nov 2026, after Sunday sitting and review) |
|---|---|
| 332 | R2 installed; first scheduled :17 run and alarm email accepted Sunday. Keep G0 (2027 opening) and G0c (first nightly without HALT) pending, plus the later G1-G7 seasonal reviews. Do not defer G0/G0c to Opening Round. |
| 348 | Refresh and re-seal the January rehearsal including groups (f)-(k). Tue 12 Jan 2027 11:00 AEDT is reserved for an attended load after that rehearsal; the production write set still needs separate owner approval. No load executed. |
| 350 | R8 draft approved: capture Fri 19 Feb 2027; proposed opening Tue 23 Feb 2027 11:00 AEDT. Obtain execution approval for the refreshed plan/revision/write set/window, perform G0 and observe G0c on the first nightly (24 Feb if opened 23 Feb). |
| 351 | R1 installed Sunday. R6 approved window Wed 25 Nov 10:00-11:00 AEDT, fallback 14:00-15:00; reboot remains pending and NO-GO until every amended runbook gate passes. First weekly window and later acceptance remain pending. |
| 352 | BEFORE Mon 23 Nov 03:10 AEDT: owner installs the pinned invocation-logging wrapper and new verifier from bc3fef3de375259d49001e7a9a478624832703a8. Observe Monday scheduled pull/next nightly within 25 h, Wednesday 03:10 overnight pull and 03:36:35 separate restore verification; all pending. D-HO-7 remains for R7. |
| 357 | R4 deny installed and probes passed Sunday. Owner operational acceptance remains open; retain beta gate until a cache bound and disk alert exist, with F-09 prune validation. |
| 362 | R4 filter live; R5 retained logs restricted and verified Sunday. Earliest disposal REVIEW Thu 7 Jan 2027; disposal needs separate owner approval. No disposal authorized by these fixes. |

## Historical planning matrix (superseded by current actions above)


Planning record, not a result. Assumes each sitting PASSES as written; a failed step keeps its issue in the "before" state and
adds the failure record. Sittings: **A1** (Tue 24 Nov 10:00, release `7d92042f`), **A2** (Tue 24 Nov 10:30, R1-R4),
**B** (attended reboot R6: **APPROVED for Wed 25 Nov 2026 10:00-11:00 AEDT, fallback 14:00-15:00**, runbook
`ATTENDED-PLAN-R6-20261125.md`, NO-GO by default until its §7 items hold; housekeeping R7 on or after Thu 7 Jan 2027), **L** (ISSUE-348
load, separate approval; **PROPOSED Tue 12 Jan 2027 11:00 AEDT**, not approved, `issue348-acquisition/LOAD-WINDOW-PROPOSAL.md` §3/§3a),
**D** (2027 opening R8, draft APPROVED for Tue 23 Feb 2027 11:00; capture Fri 19 Feb). The owner is on leave 26 Nov 2026-6 Jan 2027
inclusive. Sources: `ATTENDED-PLAN-A1-A2-20261124.md`, `ATTENDED-PLAN-R6-20261125.md`, `DECISIONS-20261122c.md`, `-d.md`, `-e.md`.

## 1. Per issue

| Issue | Closes when (evidence still needed) | After A1 | After A2 | After B | After L | After D |
|---|---|---|---|---|---|---|
| **371** (`/brownlow` stale 404 head) | Released with the env; 8 fresh-connection samples of `/brownlow/2026` 200 with the published title and no not-found head; season refresh "2/2 worker(s)" | **closable** on P5 (1-4), raw-head check, S9 and P6 PASS | — | — | — | — |
| **372** (stale 404 head, other worker) | Same release; `/seasons/2026` raw-head equal to baseline on every sample; revalidate CLI 2/2. Residual exposure (debut player pages, `/matches/<id>`) is documented in the issue: record it as the accepted residual or keep a follow-up | **closable** with the residual recorded | — | — | — | — |
| **351** (host patching, reboot) | R1 installed and its four checks; weekly window in use (first `status --confirm-restart-invocation` in a window); the attended reboot to `6.8.0-149` (**APPROVED** round 4 for Wed 25 Nov 10:00 AEDT, fallback 14:00; `ATTENDED-PLAN-R6-20261125.md`) with its acceptance (F-1..F-6: kernel, units, A3 status/post-install-check, `reboot-required` gone, GRUB restored to the baseline) and the deferred Thu 26 Nov settle (observer: the R2 hourly mail, silence = OK; recorded on return) | open: R1 not yet | open: R1 done; **reboot pending** (consequence: `DECISIONS-20261122c.md` §5.1) | **closable** after R6 acceptance and the first weekly window; after a rollback to 137 it stays open (GRUB default kept at 137 for the leave, R6 §6) | — | — |
| **352** (backups, off-host) | Units' attended first runs; `status` 0; first verified off-host pull; first-copy restore recorded; **the next nightly off-host within 25 h** (supplied by the approved daily pull cron job r3, first run Wed 25 Nov 03:10); first Wednesday verification; D-HO-7 (R7) | open | open: r3 cron installed; needs the 25 Nov 03:10 pull observed (§4) and the first Wednesday 03:30 verification (25 Nov) | R7 drop done → **closable** if the 25 h and Wednesday evidence exist | — | — |
| **332** (2027 operations; G0b) | Forced-command key and first manual run OK (A2); hourly check installed (cron r2 APPROVED, installed in A2 after the manual run); delivery proven (22 Nov: done); G0, G0c at the opening; the later dated reviews (round 2 reviews, C7 acceptance, Brownlow successor) keep it open into 2027 | open | open: key + first run + r2 cron (first `:17` run verified in the sitting) + cron-environment alarm test done; r3 first run observed Wed 25 Nov (R6 A-1) | open | open | open: G0/G0c recorded; remains open for the 2027 dated reviews |
| **357** (ISR per 404 path) | R4 deny installed and probes PASS; operational acceptance is the owner's; the residual (well-formed unknown slugs, about 76 KiB each) stays behind the beta gate; pre-launch requirements (a cache bound and a disk alert; F-09 prune script promoted with a test) before the gate is turned off | open | R4 done: owner decides whether to resolve with the residual recorded or keep open for the pre-launch requirements | — | — | — |
| **362** (auth hygiene) | R4 log filter (redaction probe PASS); O-1 pre-fix logs: **retained with restricted access** (R5 APPROVED round 4: A2 §4.5a + owner re-verify + inventory); **earliest disposal REVIEW Thu 7 Jan 2027** (not a disposal date; disposal needs a separate approval; `R5-RETENTION-PROPOSAL.md` §5, §7) | open | R4 done; R5 restriction, re-verify and inventory done; open for the review | open | open until the 7 Jan review decides (closable then; disposal itself is a later sitting) | — |
| **350** (2027 season row) | The R8 opening with G0 OPEN, G0c (first nightly, no HALT) | open | open | open | open | **closable** after G0c (24 Feb nightly) |
| **348** (DraftGuru re-acquisition) | F-1 and F-2 ACCEPTED (22 Nov round 3); round 4: the eight named columns = groups (a)-(e); **Groups (f)–(k) are confirmed for the January rehearsal. The production write set needs separate owner approval after re-sealing.** (round 5, `DECISIONS-20261122f.md` §3; `LOAD-WINDOW-PROPOSAL.md` §2a); `afldb_backup` read access **verified on production 22 Nov** (§2b); window approval (PROPOSED Tue 12 Jan 2027 11:00); the §3a refresh; a fresh backup; the load (`i348-load.sh` verify, digest pre MATCHES, load, digest post MATCHES); draft pages render. Precondition: `7b52c46c`'s blobs published (done, in `731a5025`) | open | open | open | **closable** on `digest post MATCHES` and `POSTLOAD RESULT PASS` | — |
| **373** (Gridley G-c) | **RESOLVED 2026-11-22 (run d)** as an accepted residual: 118 findings listed in `issue373-gc-investigation/ACCEPTED-RESIDUAL-118.md`; any other G-c finding needs its own explanation | — | — | — | — | — |
| **363** follow-ups | 363 is resolved (tier P opt-in). Its only follow-up, ISSUE-373, is resolved | — | — | — | — | — |

## 2. Artefacts created by the sittings that need a later disposal decision

- `~/env-before-revalidate-<STAMP>.bak` on production (A1 E1): a full copy of the production `.env`, **every production secret**,
  mode 0600. Keep only until A1 is accepted and the owner no longer wants the fallback; then `shred -u ~/env-before-revalidate-*.bak`
  (owner, attended). Record the disposal.
- `~/.ssh/authorized_keys.pre-a2-settle-<STAMP>` and `…pre-a2-backup-<STAMP>` (A2): copies of arm's public-key file; delete once the
  key lines are accepted.
- `/home/arm/a1-rawhead-baseline.json` and `/home/arm/a1-build-<STAMP>.log` (A1): no secrets; keep with the sitting record.
- `/etc/caddy/Caddyfile.pre-combined-<stamp>` (A2 R4): the rollback copy; keep until R4 is accepted.
- **The R6 DigitalOcean snapshot** `afldb-prod-pre-r6-20261125` (if taken, R6 B-2): a full disk copy holding `.env` and every secret,
  the database, SSH keys and the R5 retained pre-fix logs, in the owner's DigitalOcean account. **Disposal REVIEW date Thu 7 Jan 2027**
  (with R5's); deletion is the owner's, in the panel; record it.
- `/root/grub.cfg.pre-r6-20261125` (R6 C-1): root-only copy of the pre-R6 GRUB config; no secret; may be removed after R6 is accepted
  (owner, `sudo rm`), or kept to 7 Jan.
- The two sitting backups of production data created by R3 (`/home/arm/backups/afldb-scheduled/…`) are retained by the units' own
  `--keep 14`; the streamanator first-copy workspace is deleted after its record (runbook §4.3 step 12).

## 3. Owner inputs outstanding (none blocks A1/A2)

1. ~~A1 time option~~ **answered 22 Nov: T-1, start 09:20 AEDT** (`A1-TIMING-OPTIONS.md`). Still to give on the day: the PREP tip in
   the first message.
2. ~~R6 decision~~ **answered 22 Nov (round 4): APPROVED** for Wed 25 Nov 10:00-11:00, fallback 14:00-15:00. Still to do on the day:
   the Recovery Console login check (NG-CONSOLE), the snapshot (B-2), the GRUB read and option B steps (C-1, C-2), all in
   `ATTENDED-PLAN-R6-20261125.md`; the owner may rehearse option B on a temporary droplet beforehand (optional, his cost).
3. R5: ~~retention~~ **approved 22 Nov (round 4)**; the disposal decision (option 1 or 2, `R5-RETENTION-PROPOSAL.md` §5) is due at the
   earliest REVIEW date, Thu 7 Jan 2027, as a separate approval.
4. ISSUE-348: the eight named columns are groups (a)-(e) (round 4); **groups (f)-(k) CONFIRMED into the January rehearsal (round 5, DECISIONS-20261122f.md §3)** (`LOAD-WINDOW-PROPOSAL.md` §2a);
   approve or move the PROPOSED window Tue 12 Jan 2027 11:00 after the §3a refresh packet.
5. R7: the separate disposal decision for the five databases, on or after Thu 7 Jan 2027.
6. ~~Alarm de-duplication~~ **answered 22 Nov (round 4): keep the hourly check; one email per hour while production is unreachable
   is accepted** (F-013 resolved). `remove r2` stays available.
7. R8: on 19-23 Feb 2027, the execution approval (plan digest, writes, revision, window).

## 4. First scheduled cron runs (record after A2; `a2-cron-observe.sh all`, read-only, on streamanator)

| Job | Installed (Melbourne time) | Next due printed by the installer | First scheduled run seen | Result line (rc, status) | Alarm emails since install | Recorded by, when |
|---|---|---|---|---|---|---|
| r2 hourly settle check (`17 * * * *`) | | | (the first `:17` after install; verified in A2, runbook §4.2 step 3) | | | |
| r3 daily off-host pull (`10 3 * * *`) | | Wed 25 Nov 2026 03:10 | (R6 step A-1/A-4, Wed 25 Nov) | | | |

The 22 Nov test-alarm email delivery stays separate evidence (`DECISIONS-20261122c.md`); the cron-environment alarm test of A2 §4.2
step 4 is recorded in the A2 report.

### 4a. Filled in after the sittings of Sunday 22 November 2026 (`SITTING-A1-A2-20261122.md`)

The sittings ran on Sunday 22 Nov (attended), not Tuesday 24 Nov; this supersedes the dates above. Cron and timer times are Melbourne.

| Job | Installed | Next due printed by the installer | First scheduled run seen | Result line | Alarm emails since install | Recorded by, when |
|---|---|---|---|---|---|---|
| r2 hourly settle check | Sun 22 Nov 14:58:11 | Sun 22 Nov 15:17 | **Sun 22 Nov 15:17:01** | `rc=0 AFLDB_SETTLE_STATUS OK` | 0 from the scheduled run (the one extra `alarms.log` entry is the manual failed pull of 04:06:26Z) | `a2-cron-observe.sh r2`, 15:20:56 |
| r3 daily off-host pull | Sun 22 Nov 15:14:11 | **Mon 23 Nov 2026 03:10** | pending (Mon 23 Nov 03:10, after the 02:21:25 backup) | — | — | observe with `a2-cron-observe.sh r3` |

Other due times: first scheduled backup **Mon 23 Nov 02:21:25**; first Wednesday restore verification **Wed 25 Nov 03:36:35**; the R6 plan's "Wed 02:20 / 03:10" assumptions are superseded (Mon and Tue backups and pulls will already have run).

Per issue after the sittings: **371 and 372 RESOLVED** (A1). Still open and the exact missing evidence: **332** the 2027 reviews only (the cron-environment test email arrived, owner-confirmed, 14:58); **351** the R6 reboot (Wed 25 Nov 10:00, own approval) and the first weekly window; **352** the Mon 23 Nov 03:10 pull (next nightly off-host within 25 h), the Wed 25 Nov 03:36 verification, D-HO-7 at R7; **357** the owner's acceptance of the live deny and the pre-launch requirements; **362** the 7 Jan 2027 retention review; **350, 348** unchanged.
New artefact needing disposal: `/mnt/ssd/afldb-offhost-prod-recovery-20261122` on streamanator (the two originally quarantined dumps, kept as recovery copies; review with the R5/R6 disposals), and `state/offhost-pull.sh.pre-stamp-fix-ea48205a`. The `~/env-before-revalidate-20261122T033359Z.bak` on production (every production secret, 0600) is as §2.
