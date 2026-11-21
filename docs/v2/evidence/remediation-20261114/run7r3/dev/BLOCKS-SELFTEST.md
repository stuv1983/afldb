# Release 7R3 block self-test (DEV, 21 November 2026)

**What.** The 7R3 data and page blocks, run **unchanged** on streamanator. They used only their documented `R7R3_*` overrides (checkout,
env file, data directory, identity). Script: `r7r3-blocks-selftest.sh`. Raw summary: `BLOCKS-SELFTEST-SUMMARY.txt`, which is DSN-free
and holds aggregates, public names and ids only.

**Where.**
- **Data.** A disposable copy (`afldb_v2_r7r3blk_test`) of the 18 Nov production dump, brought to production's current state (2026
  player seasons `pending`, as B1a), in the isolated cluster `/mnt/ssd/afldb-bv2026-20261121/pg-rst`.
- **Code.** The candidate `c8d4202a` as a clean Git checkout (`/mnt/ssd/afldb-r7r3-20261121/blk`), with a production build that
  prerendered from the pending copy.
- **Serving.** Served on loopback with the beta gate on. No production contact.
- **Cleanup.** The copy, the dump stand-in, the D1v cluster and every data directory were **deleted** after the run. The earlier
  prod-dump copies from the ISSUE-370 rehearsal remain in the stopped pg-rst cluster, as recorded in the runbook.

**Bytes.** The third run's block hashes (first 12 hex of each sha256, line 1 of the summary) equal the files in `SHA256SUMS`, with
two exceptions, both changed after that run:
- `r7r3-d1-backup.sh` (`fbf7fc2a…`): the count fix below. Its changed lines were re-run verbatim against a pre-attachment dump and a
  published-state dump.
- `r7r3-p2-ff.sh` (`855d12f2…`): the `CAND..PREP` records allowlist also admits `issues/open/AFLDB-ISSUE-370.md` and
  `issues/open/AFLDB-ISSUE-370-evidence/`. P2 needs production's `origin/main`, so the self-test does not run it. The allowlist regex
  was tested against accepted and rejected sample paths, and the script passes `bash -n`.

`SHA256SUMS` pins the full values.

## Final run (2026-11-21T05:37Z, the bytes pinned in `SHA256SUMS`)

**Why it was rerun.** The incident reconciliation (`../DEV-QUALIFICATION.md` note 3) replaced the self-test's `fuser -k $PORT` with
an own-process-group launch and stop, and added an early STOP when the copy is unreachable. The rerun uses exactly the pinned bytes:
every one of the 15 script hashes in its header equals `SHA256SUMS`, including the later `r7r3-d1-backup.sh` and `r7r3-p2-ff.sh`
fixes below.

**Result.** Every step in the table below passed again, in the same order:
- A1, P10 and A3 in every phase;
- D1v (`VERDICT PASS`), plan digest `100c112f…76aa7`, dry run, commit;
- reverse-commit, A1 `reversed` and re-commit;
- publication `{"ok":true,…,"rowCount":183,"votesTotal":1242,"winners":[9910]}`;
- the post-publication reversal refused with `already_published`;
- 0 server-log errors.

**Isolation.** Each of the three servers ran and stopped in its own process group on 127.0.0.1:3371. DEV's `afldb.service` was
untouched: MainPID 1167221 and `NRestarts=3` before and after. Record: `HARNESS-PROOF-SUMMARY.txt` §4b.

**A failed precondition.** An attempt just before it (§4 there) failed: the isolated `pg-rst` cluster had been stopped during
cleanup. `isolated-pg` refused to send credentials, so the env file was never written and every block STOPped without touching data.
The self-test now stops at once in that case.

**Cleanup.** The copy and data directories were deleted afterwards, and the cluster was stopped.

## Result (third run, 2026-11-21T04:19Z)

| Step (production order) | Result |
|---|---|
| A1 `before` | PASS: round grain `9522\|621\|1242\|0\|0`, no mirror, no season rows, `pending\|669\|0\|0`, unpublished, season complete |
| P10 `pending` (unattached) | PASS: 11 pages × 8 samples, anonymous control 307 |
| D1 stand-in (pg_dump of the copy) → **D1v** on a brand-new cluster | `VERDICT PASS backup proven by a fresh disposable restore`. Restore clean in 7 s; 9 parity aggregates equal; 24 fact lines equal (all but identity); **plan on the restored copy = digest `100c112f…76aa7`**; dry run on the copy PASS |
| D2 `target`, `plan` | PASS; `PLAN season=2026 rows=9522 positive=621 votes=1242 matches=207/207 attach=9522 mirror=9522 digest=100c112f…76aa7`, equal to the 18 Nov rehearsal digest |
| D3 `dry` | PASS (`APPLY DRY-RUN (rolled back) … unattached_after=0 mirror_after=9522`) |
| D3 with a wrong digest | refused by the block before connecting (digest ≠ the reviewed plan file's). The tool's own `export_digest_mismatch` refusal was shown in the ISSUE-370 rehearsal |
| D4 `commit` | PASS (`APPLY COMMITTED … audit=<id>`) |
| A1 `attached` | PASS: 9,522 attached, 207 matches each with exactly one 3/2/1 set, mirror `9522\|621\|1242`, 0 differences round↔match per player and per cell, Pendlebury `17151:2,17247:3`, still `pending`, unpublished; **every other season unchanged** (round, mirror, season rows, player seasons, coverage, publication) |
| P10 `pending` (attached, unpublished, freshly rendered) | PASS: the attachment is not public |
| A3 browser function, `pending` (headless Chromium with a minted beta cookie) | PASS, 11/11 |
| R1 `reverse-dry` | PASS (`unattached_after=9522 mirror_after=0`) |
| R1 `reverse-commit` → A1 `reversed` → D4 `commit` again | PASS / PASS / PASS: exact reversal back to `before`, then re-attachment from the same reviewed plan |
| Publication, using the real `publishBrownlowSeason` (the Super Admin writer) with the proposed D-370-1 list (14 ids) | `{"ok":true,"value":{"season":2026,"revision":2,"rowCount":183,"votesTotal":1242,"winners":[9910]}}` |
| A1 `published 14` | PASS: `bsv2026 183\|1242\|1\|14`, winner `Nick Daicos:47`, ineligible ids = exactly the 14, 0 differences round↔season and player-season↔season, `complete\|669\|669\|1242`, coverage complete ×3, published; other seasons unchanged |
| P10 `published <14 slug-ids>` (freshly rendered) | PASS: Pendlebury 5 (R8 3, R21 2), Daicos 47, 25 round blocks, `/brownlow` lists 2026, `/brownlow/2026` 200 with the right standings and exactly 14 "Recorded ineligible" rows, 2025 control intact |
| A3 browser function, `published` | PASS, 11/11 |
| R1 `reverse-dry` **after** publication | `REFUSED AttachmentRefusal already_published`, as §8.3 of the packet requires |
| Server logs | 0 error/unhandled lines in all three serves |

## Defects the self-test found and fixed before the manifest was cut

**First run** (blocks pinned to `9626bce1`):
- D1v: `pg_restore --list | grep -q` under `pipefail` stopped on SIGPIPE. Now `grep > /dev/null`; every other `echo | grep -q` became a
  here-string.
- D2 `target`: the import role cannot read `auth_users`. The actor ids now come through the read-only backup role.
- The A3 runner's Playwright import (DEV harness only).

The first run also showed the expected negatives: `published` and `attached` FAIL while 2026 is unattached and unpublished.

**Second run:**
- D1v gave the import role the backup-role slot, so the actor lookup on the copy failed. It now uses the copy's owner DSN read-only.
- A3's season-page parse needed `\s*` between the DOM text nodes.

**After the third run:**
- D1's DB-free dump proof had a count that also matched its own `votes_non_null` line. It is fixed and re-proven, with the positive
  and negative cases in the summary addendum.

**Not exercised off production:**
- P1–P4, P8, S9: their logic is unchanged from 7R2, which ran P0–P3b on production, apart from pins and the new 2026 state checks.
- `backup.sh` itself, the established B1a-0 tool.
- Each of these blocks passes `bash -n`.
