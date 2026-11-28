# R6 independent-review fixes: rehearsal record, 23 November 2026 (streamanator; disposable; production not contacted)

**Result: PASS.** Every case below ran against helper revision `7af24a74b15af39b0bdebeec9be0b089c8adc8a1`. The
printed blocks of the [R6 r2 amendment](../../ATTENDED-PLAN-R6-20261125.md) were run verbatim from a clean `git archive`.
Production was not contacted. Nothing was pushed, deployed or rebooted. Full log:
[rehearsal-20261123T1202Z.log](rehearsal-20261123T1202Z.log) (SHA-256
`8807175d67186f9938395b047d93bc7d288d74534c1ef4fe125afa52de7ea64d`). The runbook was SHA-256
`d0f88474f0d9d18267a4d4c1bc1d388c4a487322566139d752fd46297fa1b415` when the blocks were cut from it. That digest is not
re-checked here; the block hashes below are the stable anchor.

## Pins

| Item | Value |
|---|---|
| Helper revision (tested scripts) | `7af24a74b15af39b0bdebeec9be0b089c8adc8a1` |
| Manifest (`R6-SHA256SUMS`, 15 lines) | SHA-256 `53b8cb1031c1d0204c7bf0a413efa5cb2ea1e5c37b2025f111ed1bc1de78b0fc` |
| `r6-pre-verify.sh` (A-2) | `0d9e97a5d5882203703ca36083a84284f30158c0475f6a1b1926359854bd6ad9` (was `fa8d34f0…` at 58e35ce8, `1d61b086…` at b48a2c5e) |
| `r6-rawhead-check.sh` (F-4, new) | `cc8854f0bbce305e1071e3eea30100e18d742ae15cddbd1f9a19b908ad100b50` |
| `r6-post-verify.sh` | `478f85cd…` (unchanged since 58e35ce8) |
| `a1-rawhead.sh` (Sunday, unchanged) | `cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0` |
| `r6-offhost-verify.sh` (Tuesday G0b pin, unchanged) | `429eec29acf254179c3b7ae7d6489a6c695981fd90996c5c2ce1301314bcc18c` |
| Archive tar from block 1 | `f404d94477fbcbab5390bf27cbbf55d37111f4a8a3b54a1e4bce3c700c6ca7a9` (same on the workstation and on streamanator after block 2; recorded, not a gate) |
| Printed blocks 1–5 (SHA-256 of the text) | `6656f4f1…`, `87275340…`, `354a7011…` (production transfer, not run), `24294459…`, `0e1454df…` (full values in the log) |
| Container image | `sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba` (Ubuntu 24.04.4, local on streamanator), `--network none`, `--rm` |

## Finding 1: A-2 stops when the serving-release check fails

`release.mjs status --expect` is **not** read-only. A live PASS appends a `status-pass` line to `events.log`
(`deploy/release.mjs:1539-1545`, the same bytes at 7d92042f and 17822b29; Tuesday's `r1-p1-precheck.sh:119` says the same). The
owner chose the read-only form. `serving_release()` in `r6-pre-verify.sh` runs `node deploy/release.mjs status` once. It passes
only when all of these hold:

* the exit code is 0;
* there is exactly one `release: STATUS PASS|FAIL` line, and it is exactly `release: STATUS PASS <CURRENT_ID>`;
* there is no `restarted since the last attested PASS` note.

Otherwise A-2 gets a FAIL line, which means `R6 PRE RESULT STOP` and exit 1.

**Fixture** (container `afldb-prod`; all A-2 sections otherwise pass):

* the real 17822b29 `deploy/release.mjs` against a release root at the production path;
* the real 17822b29 supervisor over the rehearsal stub server, with 2 workers;
* an `events.log` holding the promote and Tuesday's attested `status-pass`.

Production-only facts not under test (kernels, systemd and journal values, psql, df, the clock at Wed 09:25 AEDT) are fixture
shims. The staged A-2 is run as arm with `accepted <CURRENT_ID> r3:yes r4:yes 10:00`.

| Case | A-2 exit | Verdict | FAIL lines | events.log |
|---|---|---|---|---|
| Expected attested release (real `status`) | 0 | `R6 PRE RESULT PASS` | 0 | byte-identical |
| Wrong build ID: A-2 given `17822b29e6de-WrongBuildId0000000000` (real) | 1 | STOP | 2 (current, serving release) | byte-identical |
| Later unattested restart: new MainPID and InvocationID after Tuesday's attested PASS (real) | 1 | STOP | 1 (serving release: restarted since the last attested PASS) | byte-identical |
| **Current symlink matches and 2 workers exist, but `status` exits 1** (service still runs the previous release; real) | 1 | STOP | 1 (serving release: exit 1, no PASS line) | byte-identical |
| Same fixture through the **58e35ce8** A-2 (INFO-only status) | **0** | **PASS** | — | — |
| Stub `status`: exact PASS line, exit 0 | 0 | PASS | 0 | byte-identical |
| Stub: exact PASS line, exit 1 | 1 | STOP | 1 | byte-identical |
| Stub: PASS line naming another build | 1 | STOP | 1 | byte-identical |
| Stub: PASS line with a longer ID | 1 | STOP | 1 | byte-identical |
| Stub: no result line | 1 | STOP | 1 | byte-identical |
| Stub: duplicate PASS lines | 1 | STOP | 1 | byte-identical |
| Stub: a FAIL line and a PASS line | 1 | STOP | 1 | byte-identical |
| Stub: restart note plus a PASS line | 1 | STOP | 1 | byte-identical |

The 58e35ce8 row reproduces the defect: the old A-2 passed a promoted-but-not-restarted service.

## Finding 2: one copy-ready archive and checksum procedure

The workstation driver [run-printed-blocks.sh](run-printed-blocks.sh) cuts each block out of the runbook text by position and runs
it unchanged:

* block 1 (archive): workstation, exit 0.
* block 4 (staging): run on the workstation and then on streamanator, after block 2's transfer. Each printed **15 `: OK` lines**
  and `R6 STAGE VERIFIED … (15 files)`, exit 0.
* block 5 (re-check): run on streamanator against copies of the verified root.

| Change | Printed result | Exit |
|---|---|---|
| none | `R6 STAGE OK` | 0 |
| one staged file (`r6-pre-verify.sh`) changed by one byte | `FAILED`, `R6 STAGE STOP` | 1 |
| one staged file changed **and** its manifest line rewritten to match | `R6 STAGE STOP` (manifest digest rule) | 1 |
| an extra file in the root | `R6 STAGE STOP` (file-count rule) | 1 |
| one staged file removed | `FAILED open or read`, `R6 STAGE STOP` | 1 |
| block 4 run on an archive with one changed file (`r6-rawhead-check.sh`) | 14 OK, 1 `FAILED`, `R6 STAGE STOP: do not use this staging root` | 1 |

Block 3 (production transfer) was not run.

## Finding 3: F-4 raw-head entry point guarded

`r6-rawhead-check.sh` runs only `hostname` and `id -un` until it has confirmed `arm` on `afldb-prod`. It then checks the staged
`a1-rawhead.sh` against `cab4a43a…` and runs it unchanged in `check` mode. Three probe detectors show whether the probe ran:

* `.env` is replaced by a FIFO whose writer records each open;
* a `mktemp` wrapper records each call;
* a loopback proxy counts connections on the `.env` port.

The baseline was written by the staged `a1-rawhead.sh baseline`, as on Sunday.

| Case | Host / user (set by Docker / setpriv, not shimmed) | Exit | Output | Probe |
|---|---|---|---|---|
| Valid disposable fixture | `afldb-prod` / arm | 0 | `RAWHEAD RESULT check PASS` | ran: 24 connections, 1 temp file, `.env` opened twice |
| Wrong user | `afldb-prod` / ops | **2** | `STOP not arm@afldb-prod (host 'afldb-prod', user 'ops')` | **never ran**: 0 connections, 0 temp files, `.env` never opened |
| Wrong host | `afldb-dev` / arm | **2** | `STOP not arm@afldb-prod (host 'afldb-dev', user 'arm')` | **never ran**: 0, 0, never opened |
| Changed helper (one byte appended) | `afldb-prod` / arm | 2 | `STOP … not Sunday's pinned cab4a43a…` | never ran |
| Contrast: Sunday's bare `a1-rawhead.sh check` on the wrong host | `afldb-dev` / arm | 1 | — | **ran**: `.env` opened twice, temp file created, a request made |

Sunday's baseline was unchanged by every F-4 run.

## Repeat (Astra): RETIRED 27 November 2026, do not run

**RETIRED (review finding 5, 27 Nov 2026).** The repeat command below is kept only as the record of what was run on
23 November; the results above and the log are unchanged. It must not be run again: the r2 driver overwrites fixed `/tmp`
paths, swaps the shared `/tmp/afldb-r6-20261125-r2.tar` in place, and ends with wildcard removal on streamanator and the
workstation (`/tmp/afldb-r6-20261125-r2.*`, `/tmp/afldb-r6-recheck.*`, `/tmp/afldb-r6-bad.*`, `/tmp/afldb-r6fix-fixture.*`), so
a repeat can destroy an operator's real staging root or another run's files. From 27 Nov both entry points,
[run-printed-blocks.sh](run-printed-blocks.sh) and [rehearse-r6-fixes.sh](rehearse-r6-fixes.sh), print `REFUSED: RETIRED …`
and exit 2 before they read, create or remove anything (no override; the 23 Nov body is kept below the refusal, unreachable;
the bytes that ran are `git show 7af24a74:<path>`). To repeat a printed-block rehearsal use the run-scoped driver
[`../review-fixes-r3-20261124/run-printed-blocks.sh`](../review-fixes-r3-20261124/run-printed-blocks.sh) (tags `r3`, `r4`);
the refusal is proved by suite f5, `../review-fixes-r4-20261127/cases/f5-cleanup-ownership.sh`
(record: `../review-fixes-r4-20261127/README.md`).

What was run on 23 November (historical; the fence is no longer marked as a shell block because it is not to be copied), from
a Git Bash workstation with the repository at `/d/dev/afldb` holding `7af24a74`, from any checkout of the review commit:

```text
bash docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-20261123/run-printed-blocks.sh "$PWD" /tmp/r6-repeat
```

Results it gave on 23 November (expected then; today the command prints only the refusal):

* `files verified: 15`;
* the five block-5 rows and the bad-archive row above;
* `R6 FIX REHEARSAL RESULT PASS` with `role=prod: 31 passed, 0 failed` and `role=wronghost: 2 passed, 0 failed`;
* `left: 0` and `containers left: 0`.

The driver needs streamanator (`arm@10.0.40.100`, key `afldb_dev`), Docker for arm there, the image above and
`/home/arm/.nvm/versions/node/v22.23.2`. It removes what it creates on both machines. (27 Nov 2026: that sentence is the
23 Nov claim; the removal was by wildcard and by image ancestor, not by ownership, which is why the driver is retired.)

## Limits

* The A-2 fixture shims production-only facts. It proves the verdict logic and the read-only property against the real
  `release.mjs`, not production's systemd, journal or database.
* Production's real `events.log`, InvocationIDs and Tuesday's sitting record are not available before Wednesday. The restart rule
  depends on the last attested `status-pass` line being the one named in the amendment's mapping.
* The containers are not production. Production's boot path remains unrehearsed (reviewer F-017).
