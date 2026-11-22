# Sunday review repairs — 22 November 2026

**Before Monday 23 Nov 03:10 AEDT:** owner must install the new invocation-logging wrapper and
`scheduled-pull-evidence.sh` on streamanator from code commit
`bc3fef3de375259d49001e7a9a478624832703a8`, check their full pins, and ensure the cron CMD
journal can be retained/read. Nothing was installed by this repair session. See the dated
amendment at the end of `../ATTENDED-PLAN-R6-20261125.md` for exact commands.

Reviewed starting tip: `0f4accf76d6525b04aacdcee548f27add0daa8d5`, branch
`claude/backlog-20261122`, initially clean. The primary checkout was not touched.
Tests ran as arm on streamanator in `/mnt/ssd/afldb-astra-review-jZGZpp`, with disposable
synthetic files and process/cron fixtures; no production contact, database, cron install,
email, service operation or reboot. First-copy evidence was read separately from the
authorized retained streamanator files. Fixtures do not prove production boot recovery.

| Finding | Result |
|---|---|
| Scheduled backup identity | Both r3 observers delegate to the pinned verifier. An explicit Melbourne date, independent 03:10 cron CMD/PID, matching invocation BEGIN, completion by 03:45 with rc=0, and that invocation's exact dump/SHA verification are required. Production SHA must equal sidecar and recomputed off-host SHA; marker required, active hold rejected. A later successful retry never replaces a failed scheduled invocation. Missing/ambiguous/stale/failed evidence returns nonzero with a reason. |
| Timestamp harness exit | Failed assertions now exit 1. All original DST, future, quarantine, and unchanged-retry retention assertions remain. |
| Revalidation process configuration | Primary and both child release workers identified by PID, release cwd and distinct worker ordinals. Exactly one non-empty URL and SECRET required per process; values never printed. Functional 2/2 revalidation in the R6 runbook remains a separate required check. |
| P6 title | Parses actual HTML head titles, excluding script/RSC data. Each target must match its expected title; missing, unterminated or not-found title fails. Sunday remains four original NOT OK ticks, followed by the owner's narrow waiver and recorded acceptance of 371/372. No historical tick was rewritten to PASS. |
| First-copy restore | Exact DUMP line, basename, full SHA and matching restore PASS recovered; details below. The `150327` dump's shortened hash was never expanded or used to infer the restored dump. |
| Operational pins | Code committed first. Full raw Git blob SHA-256 pins, including unchanged pre-check and raw-head helper, appended to the R6 runbook. `BLOB-PINS.md` is the machine-calculated inventory; installer pins tested against these bytes. |
| Tracking | Seven open issues remain: 332, 348, 350, 351, 352, 357, 362. Current actions promoted above historical instructions; no future observation or approval invented. |

| Check | Totals | Actual process exit |
|---|---|---|
| `t-sunday-review.sh <fixture source root>` | 29 passed, 0 failed | 0 |
| Corrected `t-offhost-stamp.sh` against `tools/maintenance/offhost-pull.sh` | 42 passed, 0 failed | 0 |
| Same corrected harness against pre-fix pull from `d6b983b5bfd5e018e319b871c1bd116a2fc3170b` (`8ba00067^`) | 20 passed, 22 failed | 1 (expected negative control) |
| `bash -n` on all 14 pinned operational/test shell files | 14 parsed | 0 |
| `git diff --check` and staged diff check before code commit | clean | 0 |

`behaviour.log` records actual exit codes for every case. Healthy scheduled chain, r3,
wrapper, installer-pin check, R2, process and both expected titles exit 0. Each rejection
case exits 1: manual success; Monday evidence for Wednesday; failed schedule followed by
successful retry; unrelated verified line; verification-service dump; wrong production SHA;
active hold; ambiguous dispatch; late completion; changed dump bytes; wrong sidecar; missing
marker; 0/0 env; missing secret; blank URL; duplicate secret; missing worker; absent,
not-found or unterminated title. The fixture installer `check` intentionally returns 0
even when preconditions fail, so the test also asserts `PRECONDITIONS PASS` and the pin PASS.

Reproduce on a fresh disposable streamanator source extraction of the code commit:

```bash
B=docs/v2/evidence/backlog-20261121
bash "$B/a1a2-20261124/dry-tests-20261122g/t-sunday-review.sh" "$PWD"
bash "$B/a1a2-20261124/dry-tests-20261122g/t-offhost-stamp.sh" "$PWD/tools/maintenance/offhost-pull.sh"
# Negative control: extract tools/maintenance/offhost-pull.sh from 8ba00067^ to an absolute scratch path.
bash "$B/a1a2-20261124/dry-tests-20261122g/t-offhost-stamp.sh" "$PWD/pre-fix.sh"
```

## Retained first-copy restore evidence

Read on streamanator on 22 Nov 2026, from
`/home/arm/afldb-ops/state/a2-firstcopy-restore.log`:

```text
DUMP /mnt/ssd/afldb-offhost-prod/afldb_prod-20261122-150505.dump
pg_restore exit=0, stderr lines 0
FIRSTCOPY RESULT RESTORE PASS (/mnt/ssd/afldb-a2-firstcopy-20261122T041335Z); record, then: bash /home/arm/afldb-ops/state/a2-r3-firstcopy-restore.sh cleanup /mnt/ssd/afldb-a2-firstcopy-20261122T041335Z
```

The retained sidecar `/mnt/ssd/afldb-offhost-prod/afldb_prod-20261122-150505.dump.sha256`:

```text
b3fd21c3e24f0b3fe3a5fdddea3c6c00f258b4bb5dd887dda5139406ffe5c588  afldb_prod-20261122-150505.dump
```

A fresh `sha256sum` of that exact retained off-host dump returned the identical full hash.
The full SHA is corroborated by the retained sidecar and current bytes; it was not printed
inside the original restore log. The DUMP line and matching restore result are historical
evidence for that basename. No required first-copy identity item remains missing. This is
the Sunday verification service's own dump, distinct from the Sunday `150327` attended
backup and Wednesday's future overnight dump. Do not substitute it for Wednesday's data gate.

## Outstanding evidence and verdicts

Monday's first scheduled pull and the next-nightly-within-25-h criterion remain pending.
Wednesday's 03:10 pull of the overnight dump, 03:36:35 restore verification of its own dump,
and every R6 GO item remain pending until observed. Old wrapper logs can show timestamped
pull output, individual verification messages and an aggregate rc; without invocation framing
and the dispatch link they cannot prove the strengthened scheduled chain retrospectively.
Retrieve future dispatch evidence from streamanator's CRON journal; retrieve the overnight
basename/full SHA and successful backup-unit result from production's backup journal and
that dump's sidecar, separately from `last-verify.json`.

**Push readiness:** locally verified repair commits are ready for Astra re-review; owner
push remains separate. **Reboot readiness:** NO-GO pending Wednesday's live data, console,
snapshot, GRUB, timer, apt and window gates. No test here authorizes a reboot.

The original Sunday contract remains PREP `ae51cd8d913a7523dd89fb638279e7f910054b79`.

The exact pre-fix Git blob SHA-256 is `ea48205a02e6383c2fe87a9e896afed422ff44834231270cbd22dc78c305de9b`. Both final timestamp runs used Git archive bytes. All 14 current blob pins also passed `sha256sum -c` (exit 0; `pins-check.log`).

Retained text logs have trailing spaces removed for the whitespace gate; assertion text and results are unchanged. The complete repository change list is in [CHANGED-FILES.md](CHANGED-FILES.md).
