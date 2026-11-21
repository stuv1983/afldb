# What stays open after each sitting, and the evidence each issue still needs (prepared 22 Nov 2026, run c)

Planning record, not a result. Assumes each sitting PASSES as written; a failed step keeps its issue in the "before" state and
adds the failure record. Sittings: **A1** (Tue 24 Nov 10:00, release `7d92042f`), **A2** (Tue 24 Nov 10:30, R1-R4),
**B** (attended reboot R6 and housekeeping R7, after the owner's return: dates to be given), **L** (ISSUE-348 load, separate
approval), **D** (2027 opening R8, proposed Tue 23 Feb 2027 11:00). Sources: `ATTENDED-PLAN-A1-A2-20261124.md`, `DECISIONS-20261122c.md`.

## 1. Per issue

| Issue | Closes when (evidence still needed) | After A1 | After A2 | After B | After L | After D |
|---|---|---|---|---|---|---|
| **371** (`/brownlow` stale 404 head) | Released with the env; 8 fresh-connection samples of `/brownlow/2026` 200 with the published title and no not-found head; season refresh "2/2 worker(s)" | **closable** on P5 (1-4), raw-head check, S9 and P6 PASS | — | — | — | — |
| **372** (stale 404 head, other worker) | Same release; `/seasons/2026` raw-head equal to baseline on every sample; revalidate CLI 2/2. Residual exposure (debut player pages, `/matches/<id>`) is documented in the issue: record it as the accepted residual or keep a follow-up | **closable** with the residual recorded | — | — | — | — |
| **351** (host patching, reboot) | R1 installed and its four checks; weekly window in use (first `status --confirm-restart-invocation` in a window); the attended reboot to `6.8.0-149` with its acceptance (kernel, units, status, post-install-check, `reboot-required` gone, next settle OK) | open: R1 not yet | open: R1 done; **reboot pending** (consequence: `DECISIONS-20261122c.md` §5.1) | **closable** after R6 acceptance and the first weekly window | — | — |
| **352** (backups, off-host) | Units' attended first runs; `status` 0; first verified off-host pull; first-copy restore recorded; **the next nightly off-host within 25 h** (needs the daily pull: cron unapproved, or a manual second pull); first Wednesday verification; D-HO-7 (R7) | open | open: needs a second pulled nightly (cron or manual) and the first Wednesday 03:30 verification (25 Nov) | R7 drop done → **closable** if the 25 h and Wednesday evidence exist | — | — |
| **332** (2027 operations; G0b) | Forced-command key and first manual run OK (A2); hourly check installed (unapproved); delivery proven (22 Nov: done); G0, G0c at the opening; the later dated reviews (round 2 reviews, C7 acceptance, Brownlow successor) keep it open into 2027 | open | open: key + first run done; **hourly cron decision** outstanding | open | open | open: G0/G0c recorded; remains open for the 2027 dated reviews |
| **357** (ISR per 404 path) | R4 deny installed and probes PASS; operational acceptance is the owner's; the residual (well-formed unknown slugs, about 76 KiB each) stays behind the beta gate; pre-launch requirements (a cache bound and a disk alert; F-09 prune script promoted with a test) before the gate is turned off | open | R4 done: owner decides whether to resolve with the residual recorded or keep open for the pre-launch requirements | — | — | — |
| **362** (auth hygiene) | R4 log filter (redaction probe PASS); O-1 pre-fix logs: **retained** by owner decision 5 (retention decision pending) | open | R4 done; **open for the R5 retention decision** | open until the owner decides R5 | — | — |
| **350** (2027 season row) | The R8 opening with G0 OPEN, G0c (first nightly, no HALT) | open | open | open | open | **closable** after G0c (24 Feb nightly) |
| **348** (DraftGuru re-acquisition) | Owner approval of the F-2 groups and the sealed digests; the load (`i348-load.sh` verify, digest pre MATCHES, load, digest post MATCHES); draft pages render. Precondition: `7b52c46c`'s blobs published (done, in `731a5025`) | open | open | open | **closable** on `digest post MATCHES` | — |
| **373** (Gridley G-c) | Owner choice: (1) record the accepted residual (118 findings, all approved under G-b, 0 unapproved) → resolve; or (2) N7 gate change, then N7 green on tier P and the snapshot | open (owner decision; no sitting needed) | | | | |
| **363** follow-ups | 363 is resolved (tier P opt-in). Its only open follow-up is ISSUE-373 | — | — | — | — | — |

## 2. Artefacts created by the sittings that need a later disposal decision

- `~/env-before-revalidate-<STAMP>.bak` on production (A1 E1): a full copy of the production `.env`, **every production secret**,
  mode 0600. Keep only until A1 is accepted and the owner no longer wants the fallback; then `shred -u ~/env-before-revalidate-*.bak`
  (owner, attended). Record the disposal.
- `~/.ssh/authorized_keys.pre-a2-settle-<STAMP>` and `…pre-a2-backup-<STAMP>` (A2): copies of arm's public-key file; delete once the
  key lines are accepted.
- `/home/arm/a1-rawhead-baseline.json` and `/home/arm/a1-build-<STAMP>.log` (A1): no secrets; keep with the sitting record.
- `/etc/caddy/Caddyfile.pre-combined-<stamp>` (A2 R4): the rollback copy; keep until R4 is accepted.
- The two sitting backups of production data created by R3 (`/home/arm/backups/afldb-scheduled/…`) are retained by the units' own
  `--keep 14`; the streamanator first-copy workspace is deleted after its record (runbook §4.3 step 12).

## 3. Owner inputs outstanding (none blocks A1/A2)

1. Time option T-1 or T-2 for A1 (runbook §1), in writing before the day.
2. The two cron lines (hourly status check, daily pull): approve or not (runbook §4.6).
3. Return date (or another operator) for R6/R7; Livepatch/CVE probe lines if wanted (`DECISIONS-20261122c.md` §5).
4. R5 retention decision for the pre-fix Caddy logs.
5. ISSUE-348: approval of the F-2 groups and the digests, and a window for sitting L.
6. ISSUE-373: option (1) or (2).
7. R8: approval of the draft plan, the execution revision and a capture/plan date.
