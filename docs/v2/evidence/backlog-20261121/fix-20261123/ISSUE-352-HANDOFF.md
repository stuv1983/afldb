# ISSUE-352 corrected helper pair: runbook and review handoff (23 November 2026)

**Status: LOCAL ONLY. Nothing here was installed, pushed or deployed. Installation stays on HOLD for the owner's separate approval.**
Supersedes the 22 Nov "Before Monday 23 Nov 03:10 AEDT" install block and pin table in `../ATTENDED-PLAN-R6-20261125.md`
for the two helpers and the three scripts below. The review that found the defect is
`issues/reviews/AFLDB-FULL-REVIEW-2026-11-22.md` (kept unchanged).

| Item | Value |
|---|---|
| Code commit (tested bytes) | `88be90f0e676112c4239032b2e8548389db5ec7d` |
| Parent (Astra's review commit) | `a77dacb064959057c31a96dd4aae4d37fc1af0cd` |
| Full raw Git-blob SHA-256 pins | [BLOB-PINS.md](BLOB-PINS.md) (this runbook is a separate commit that pins the code commit above) |
| Branch / worktree | `claude/review-fixes-20261123`, `D:\dev\afldb-fix-20261123` |

## What was wrong and what changed

1. **The observer rejected a genuine dispatch.** Debian cron 3.0pl1-184ubuntu2 logs `(arm) CMD (<command>)` with no
   schedule fields, and logs it from the process about to exec the job shell. Monday 03:10:01 AEDT on streamanator:
   `CRON[3729645]: (arm) CMD (AFLDB_ALARM_CMD=... /bin/sh .../afldb-offhost-pull-daily.sh)` and, in the same second,
   `CRON[3729635]: pam_unix(cron:session): session opened for user arm`. The job shell and the cron-named process above it are
   different PIDs; the proposed wrapper recorded the cron-named one, which can never equal the journal PID.
   dash 0.5.12 does not exec-optimise `VAR=x /bin/sh script` (checked read-only), so the wrapper's parent is the job shell.
2. **New contract.** The wrapper's BEGIN line records `lineage=pid:comm:start-epoch,...` from the wrapper up to init. The
   observer matches only the command portion of the journal record, verifies the `10 3 * * *` schedule separately against the
   installed crontab, and links the dispatch to exactly one wrapper run when that run's lineage contains the dispatch PID with a
   process start within 5 s of the journal timestamp and a cron-named process at or above it. A minute match, a manual run, or
   a recycled PID cannot satisfy this. END, rc, VERIFIED, production/off-host SHA, sidecar, marker and hold stay gated.
3. **Three outcomes** (last line `RESULT ...`; the exit status carries it):

| Exit | `RESULT` | Meaning |
|---|---|---|
| 0 | `SCHEDULED-COPY-VERIFIED` | bytes verified and tied to a successful scheduled invocation. The only PASS |
| 10 | `COPY-VERIFIED-ORIGIN-UNPROVEN` | bytes verified; journal unreadable/absent, ambiguous, no linked run, run did not itself verify this dump, crontab unreadable or pair missing |
| 1 | `COPY-FAILED` | bytes not verified, or the linked scheduled run failed, did not complete, or completed late. A later manual retry never replaces it |
| 2 | (usage) | bad date, dump name or checksum; the verification-service dump is never an overnight dump |

4. **`a2-cron-install.sh check` no longer exits 0 on `PRECONDITIONS FAIL`** (exit 1; `--require-installed` adds exit 6 when the
   marker+job pair is absent). It names each pinned file (missing, differs, PASS).
5. **`a2-helper-install.sh` (new) installs the pair as one checked step**: staged and installed digests, core pin, outside the
   03:00-03:55 Melbourne window, no running pull; verifier first, wrapper last (the wrapper is the activation switch, so a
   kill mid-install leaves the previous working wrapper); `*.pre-352-<stamp>` copies; rollback on failure (exit 4; exit 5 if the
   restore cannot be verified); crontab, `state/offhost-pull.log`, destination, keys, alarm settings and holds are never
   touched. Exit 0 ok, 1 `check` not current, 2 usage, 3 refused with nothing changed.

**Monday's finding stands.** `afldb_prod-20261123-022145.dump` was verified off-host (sidecar, marker, no hold, rehash
`3818c759...38fe1` per Astra's addendum) but its scheduled origin is **unproven**: the installed wrapper (digest `1aa242f2...`)
has no run ID or lineage. This code cannot supply that evidence retrospectively. Run against Monday's records it returns exit 10.

## Test evidence (run as arm on streamanator in disposable `mktemp` workspaces; no production contact, no cron edit)

| Suite | Result |
|---|---|
| `dry-tests-20261123/t-352-scheduled-origin.sh <root>` | 134 passed, 0 failed, exit 0 |
| `dry-tests-20261122g/t-sunday-review.sh <root>` (updated to the corrected contract) | 29 passed, 0 failed, exit 0 |
| `dry-tests-20261122g/t-offhost-stamp.sh <abs path>/tools/maintenance/offhost-pull.sh` (unchanged core) | 42 passed, 0 failed, exit 0 |

Cases through the real entry points: Monday's observed journal format; schedule-prefixed fixture (now 10); manual run in the
same minute (10); scheduled + distinct manual run (0, selects the scheduled run); failed scheduled run then successful manual
retry (1); scheduled BEGIN without END (1); late END (1); recycled PID on another day alone (10) and beside a valid run (0);
wrong lineage start time / no cron process above the dispatch (10); journal logging the cron-child PID (0); unreadable or empty
journal, ambiguous dispatch, other-day dispatch, missing/ambiguous crontab pair, wrong installed schedule (10); wrong
production SHA, changed dump bytes, wrong sidecar, missing marker, active hold, empty dump (1); verification-service dump as
overnight (2) and beside the overnight dump (0); run verified another dump/checksum (10); Monday's legacy log (10); real
wrapper under a real process tree and real `ps` (lineage recorded, parent present, start within the run window; `ps` without
`etimes` degrades to `lineage=unknown` and the pull still completes); helper installer: install, idempotent re-run, failed
cron precondition (exit 1) and refused cron install (3, crontab unchanged), missing/tampered staged helper, wrong core, pull
window, running pull, wrong host, SIGKILL after the first rename then safe re-run, second rename failure (exit 4, previous state
restored), unrestorable failure (exit 5); embedded pins equal repository bytes; `bash -n` on all six scripts.

## Parts that still need confirmation on streamanator (read-only unless stated)

1. **No real disposable cron dispatch was performed.** The environment refused an edit of arm's live crontab, and none was made.
   The lineage assumption (job shell PID in the CMD record, cron child above it, cron child comm `cron`) rests on the source of
   Debian cron, Monday's journal pair, a read-only dash exec check and the real-ps test. The first scheduled run on the new pair
   is the real confirmation: Tuesday's BEGIN line must show `lineage=<wrapper>:sh:..,<journal CMD pid>:sh:..,<cron child>:cron:..`.
   If it does not, the observer reports exit 10 (never a false PASS) and the lineage must be re-derived.
2. `journalctl -t CRON -o short-iso --no-pager -n 5` readable by arm (Monday's follow-up read it), and `dpkg-query -W cron` is
   still `3.0pl1-184ubuntu2`.
3. After the first scheduled run: `grep ' BEGIN ' /home/arm/afldb-ops/state/offhost-pull.log | tail -1` shows `lineage=` with a
   `cron` entry; then the observer below. Independent production evidence (the backup unit's dump basename and full SHA) remains
   owner evidence.

## Install instructions (owner; Tuesday 24 Nov before 03:00 Melbourne, or a later day outside 03:00-03:55)

On the workstation (Git Bash), from the repository:

```bash
CODE=88be90f0e676112c4239032b2e8548389db5ec7d
B=docs/v2/evidence/backlog-20261121
git archive --format=tar --output=/tmp/afldb-352-helpers.tar "$CODE" "$B/r6-20261125" "$B/a1a2-20261124" "$B/kits" tools/maintenance/offhost-pull.sh
```

Copy it to a **new** staging directory on streamanator and extract it there. In that extracted root, as arm:

```bash
B=docs/v2/evidence/backlog-20261121
sha256sum "$B/kits/afldb-offhost-pull-daily.sh" "$B/kits/scheduled-pull-evidence.sh" "$B/a1a2-20261124/a2-helper-install.sh" "$B/a1a2-20261124/a2-cron-install.sh" "$B/a1a2-20261124/a2-cron-observe.sh" "$B/r6-20261125/r6-offhost-verify.sh"
```

Every line must equal the full pin in [BLOB-PINS.md](BLOB-PINS.md). Then, one command per line:

```bash
bash "$B/a1a2-20261124/a2-helper-install.sh" check; echo rc=$?
bash "$B/a1a2-20261124/a2-helper-install.sh" install "$B/kits"; echo rc=$?
bash "$B/a1a2-20261124/a2-helper-install.sh" check; echo rc=$?
bash "$B/a1a2-20261124/a2-cron-install.sh" check r3 --require-installed; echo rc=$?
```

Expected: first `check` rc=1 (current wrapper differs, verifier absent), `install` rc=0 with `HELPER INSTALL PASS`, second
`check` rc=0, cron `check` rc=0 with `PRECONDITIONS PASS` and `INSTALLED`. Any other rc is STOP: the installer restores or never
changes the previous wrapper, and the existing crontab, state log, hold and keys are untouched. The two helpers are never
installed with separate `install -m` commands any more. The crontab is **not** modified by either installer command above.

## Observing the first scheduled run (read-only)

After 03:10 Tuesday, with the exact overnight `D` (basename) and full production `S` from the production backup unit's journal
and sidecar:

```bash
bash "$B/a1a2-20261124/a2-cron-observe.sh" all 2026-11-24 "$D" "$S"; echo rc=$?
```

rc=0 and `RESULT SCHEDULED-COPY-VERIFIED` is the first scheduled-run observation. rc=10 is recorded as "copy verified,
scheduled origin unproven"; rc=1 is a failed copy. Wednesday uses the same command with Wednesday's date and overnight dump;
the 03:36 verification-service dump is rejected as an overnight dump. The R6 pre-check's separate selector limitation
(`r6-pre-verify.sh` first-match of 02:2x/02:3x files) is tracked under ISSUE-352 and handled in a later commit.
