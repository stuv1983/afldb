# R6 r3: fixes for Astra's failed re-review of `cc3369a5` (24 November 2026)

**Status: PROPOSED; local branch `claude/r6-review-fixes-r3-20261124`; not pushed; nothing installed or deployed; production
not contacted.** Wednesday's reboot stays **NO-GO** until Astra records an independent PASS on this record and Wednesday's own
backup, attributable off-host pull, attributable restore, console and recovery checks pass. The operator procedure is the
[R6 runbook r3 amendment](../../ATTENDED-PLAN-R6-20261125.md) (section "Amendment — 24 November 2026 (r3)").

## 1. Revisions

| Role | Commit | What it holds |
|---|---|---|
| Base | `cc3369a5ebb7eaf1bc6f0e695caf9f8fa5d93c6f` | r2 (Astra re-review FAILED) |
| Scripts | `dc88fe7f4128ce5d3b0997606382e70696ade24d` | A-2, F-4 entry point, new handoff helper, rehearsal harness |
| Runbook | `cc59b2f2dfda940bd7826e7ef2b6d1dbb0e5a335` | r3 amendment (CODE then = `dc88fe7f`) |
| Driver fix | `9a9a01c195602e430d0d514e5fbe550eb77d0a9f` | cleanup path-rewrite fix (§5), proof wrapper. **TESTED commit** |
| Runbook re-pin | `de106597eec620df82365f0effb4e69469f75a01` | CODE = `9a9a01c1`; Git Bash note. Review commit the proof ran against |
| Final review | the commit adding this README | this README, `logs/`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` |

**Tree difference, tested `9a9a01c1` → final review:** `ATTENDED-PLAN-R6-20261125.md` (CODE re-pin and one operator note;
~~the printed blocks 1–5 hash identically, see §4~~ **corrected 27 Nov 2026, see below**), and the files of the final review
commit listed above. No script, harness file or pinned file differs. Check with
`git diff --stat 9a9a01c195602e430d0d514e5fbe550eb77d0a9f <final review>`; the driver also prints this difference on every run.

> **Correction, 27 November 2026 (review finding 8).** The struck clause was wrong for block 1. The CODE re-pin is *inside*
> printed block 1 (its first line, `CODE=dc88fe7f…` → `CODE=9a9a01c1…`; no other line of any block differs), so block 1's
> hash changed between the tested commit and the review commit; blocks 2–5 and the shared verification lines did not. The
> proof cut its blocks from the review commit `de106597`, whose runbook and blocks are byte-identical to the final review
> commit `cdeaf31f` (the commit that added this README). The hashes in §4 are therefore those of `de106597` = `cdeaf31f`, not
> of `9a9a01c1`. Recomputed on 27 Nov from the Git blobs (`git show <commit>:docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md`,
> each block cut by the driver's `blk`, the verification lines by its `snip`; SHA-256):
>
> | | tested `9a9a01c1` | review `de106597` | final review `cdeaf31f` |
> |---|---|---|---|
> | runbook | `88dd44a8d4def03a64628b3fcc4bfb49d6320d439f22e15f22299aac119f11ed` | `3c2bfd79d0c14e2bdbf8eeae9fc93ed3408f1b67ebe9d6d962e635dcd1fa25a4` | `3c2bfd79d0c14e2bdbf8eeae9fc93ed3408f1b67ebe9d6d962e635dcd1fa25a4` |
> | block 1 (archive, 20 lines) | **`5152d440e582449c811b164da13ed314645e5f7c41c8a7f6823c5d56873aa5d2`** | **`2d3150737a12c1e52b191838f46a1d0fe7094be4b25440078b3cccc0e83c4328`** | `2d3150737a12c1e52b191838f46a1d0fe7094be4b25440078b3cccc0e83c4328` |
> | block 2 (to streamanator, 1 line) | `31d9ee5b16a08bc059055fb6bfb831fb52aa3618c2a90028fe405370303a639d` | `31d9ee5b16a08bc059055fb6bfb831fb52aa3618c2a90028fe405370303a639d` | `31d9ee5b16a08bc059055fb6bfb831fb52aa3618c2a90028fe405370303a639d` |
> | block 3 (to production, 1 line, never run) | `034edc1f57ad4ee3162d1c6f8a6d69f2da0de975b36ea1041983c50eb895aaae` | `034edc1f57ad4ee3162d1c6f8a6d69f2da0de975b36ea1041983c50eb895aaae` | `034edc1f57ad4ee3162d1c6f8a6d69f2da0de975b36ea1041983c50eb895aaae` |
> | block 4 (staging, 28 lines) | `0b0f56692620f9fa6f46cc2e286ac4db07653366c572e397ddafdd3940950729` | `0b0f56692620f9fa6f46cc2e286ac4db07653366c572e397ddafdd3940950729` | `0b0f56692620f9fa6f46cc2e286ac4db07653366c572e397ddafdd3940950729` |
> | block 5 (re-check, 6 lines) | `d28f399a248855df1a34bcb54805d3533888e28876071b6610345c8147a0eaeb` | `d28f399a248855df1a34bcb54805d3533888e28876071b6610345c8147a0eaeb` | `d28f399a248855df1a34bcb54805d3533888e28876071b6610345c8147a0eaeb` |
> | verification lines of blocks 4 and 5 (5 lines) | `0917cf6fae503f22ac1263511165c623ced2b1b359faec783b6a3166e037888f` | `0917cf6fae503f22ac1263511165c623ced2b1b359faec783b6a3166e037888f` | `0917cf6fae503f22ac1263511165c623ced2b1b359faec783b6a3166e037888f` |
>
> The runbook at `9a9a01c1` is the blob committed at `cc59b2f2` (same SHA-256). What the correction does not change: the
> block 1 the proof RAN is the `2d315073…` one (review commit), which pins and archives `9a9a01c1`; the logs are untouched.
> Statements re-verified unchanged on 27 Nov are listed in §7.

## 2. The pinned archive (from Git blobs)

Every pin is `git cat-file blob 9a9a01c195602e430d0d514e5fbe550eb77d0a9f:<path> | sha256sum`. The 16 files are byte-identical at
`dc88fe7f` and `9a9a01c1` (checked with `cmp` of the two derived manifests). **Manifest digest
`2c7ee8e2e1758f1002a36c4b75239d4ff4dea6958e7b2410a1f0253a38978007`.** Changed from r2: `r6-pre-verify.sh` `0d9e97a5…` →
`48185fcaec83eff1cb26f1612febb32ba7d223f953cd4f6941fcc38c5eebebfb`; `r6-rawhead-check.sh` → `7c3d0fc295512a2f990bdbed24ae9ddb97a49f5f13e9bf01019ea3fa7e1f0543`;
new `r6-tuesday-handoff.sh` `92c1809b61473ab8d326b5a65bc1a30bb1eaf16e272ad0adf90a030ec039f9d8`. Unchanged: the other thirteen,
including Sunday's `a1-rawhead.sh` `cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0`.

## 3. What changed, per finding

1. **A-2 verifies the owner-attested InvocationID.** The single plain `release.mjs status` call, its merged output, real exit
   code, the exact `STATUS PASS <CURRENT_ID>` rule and the restart-note rejection are kept. A separate read-only
   `systemctl show afldb -p InvocationID --value` must equal the `inv:<32 hex>` argument; a failed read, an empty, malformed or
   multi-line value, or a mismatch is a FAIL. The expected ID comes only from the Tuesday sitting record, through
   `r6-tuesday-handoff.sh` (three strict `R6-HANDOFF` lines, cross-checked against the record's own RESULT lines), never from
   the live service or `events.log`. Outcome table (usage STOP, exit 2, for any other combination): released =
   `17822b29e6de-<BUILD_ID>` with a non-Sunday attested ID; rollback verified = `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` with a
   non-Sunday ID; deferred = the same old release with Sunday's `342040625f6d4012a35d598dfbf9afe6` and a record confirming no
   promotion or rollback. All three pass `OUTCOME=accepted`. Also new: a carriage return anywhere in the status output, or a
   second line containing `STATUS PASS`/`STATUS FAIL`, is a FAIL (a CRLF FAIL beside an LF PASS passed r2). Fixture IDs live only
   in the harness's `/tmp/fixture-records`; the real Tuesday record is not touched.
2. **Exact archive contents, both blocks.** Block 4 (staging) and block 5 (re-check) share five identical verification lines:
   the manifest's own digest equals the independent pin; every entry is owned by the operator, has no group/world write and no
   regular file has a second hard link; the complete `find -printf '%y %p'` listing equals the listing derived from the manifest
   (the root `R6-SHA256SUMS`, the 16 files as type `f`, and their parent directories as type `d`, nothing else); then
   `sha256sum -c`. Staging runs under `umask 077` in a `mktemp -d` root; the manifest is written only if absent.
3. **Wednesday instructions.** §5's F-4 row names `r6-rawhead-check.sh` (never `a1-rawhead.sh` directly); §2.1's A-2 row takes
   the r3 arguments; Tuesday RUNBOOK §8's archive choices are marked superseded for Wednesday; Tuesday's packet and Sunday's
   helper are unchanged. `r6-rawhead-check.sh` keeps its arm@afldb-prod guard ahead of everything, and now reads the helper once,
   hashes those bytes and executes the same bytes (`bash -c "$body"`), closing the reopen-after-hash gap. The amendment states
   what the private staging directory protects and what remains (a process running as `arm` or root).
4. **Repeat driver.** `run-printed-blocks.sh` gets a run ID; every remote resource is under `/tmp/r6reh.<RID>.<random>`
   (validated name, owner and type before removal), containers are `r6reh-<RID>-<n>` labelled `r6reh.run=<RID>`, the archive is
   removed only if this run created it and its bytes are unchanged, and the run refuses to start if the archive path already
   exists. No wildcard cleanup remains. Any step result other than expected, including a negative case that passes, a leftover
   container, or anything this run created that survives cleanup, makes the driver exit nonzero.
   *(27 Nov 2026: "only if this run created it" was implemented at `9a9a01c1` as "the path was absent at start, exists now and
   holds my bytes", which two runs of one revision both satisfy. Superseded by the ownership rule in §7.)*

## 4. Commands, expected and actual exit codes

Run from the workstation (Git Bash) on 24 Nov 2026 08:11–08:13 AEDT (2026-11-23T21:11Z), log
[`logs/proof-2-tested-9a9a01c1.log`](logs/proof-2-tested-9a9a01c1.log):

```
H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r3-20261124
bash <(git -C /d/dev/afldb show 9a9a01c195602e430d0d514e5fbe550eb77d0a9f:$H/prove-driver-fixes.sh) \
  9a9a01c195602e430d0d514e5fbe550eb77d0a9f de106597eec620df82365f0effb4e69469f75a01 <output dir>
```

| What | Expected | Actual |
|---|---|---|
| Proof wrapper (`R6 r3 DRIVER PROOF PASS`) | 0 | **0** |
| Run 1, tested driver, normal (`R6 r3 REHEARSAL RESULT PASS`, 10 steps, 0 unexpected) | 0 | **0** |
| Run 2, same driver, `R6_REH_SABOTAGE=b5-symlink-identical` (`CASE-RESULT b5-symlink-identical UNEXPECTED`, 1 unexpected) | nonzero | **1** |
| Sentinels after each run (4 dirs per host named like real staging roots `…-r3.<id>`, `…-r2.<id>` and other runs `r6reh.<id>`, `r6reh-ws.<id>`, plus an unrelated labelled `r6reh-*` container) | intact | **intact both times** |
| Residue of any driver run on either host after each run | none | **none** |

The driver itself (`run-printed-blocks.sh` from the tested commit, sha256 `abfaf65a5e1c5d303ea5c6545f9b44469d2e2046f24c33d173e36af3b70cd659`)
cuts the blocks from the runbook at the review commit (runbook sha256 `3c2bfd79…`; block 1 `2d315073…`, 2 `31d9ee5b…`, 3 `034edc1f…`,
4 `0b0f5669…`, 5 `d28f399a…`; the five verification lines of blocks 4 and 5 identical, `0917cf6f…`) and runs, verbatim
(27 Nov 2026: these are the review commit's hashes, as the log prints them; block 1 at the tested commit is `5152d440…`,
full values and the comparison in the §1 correction):

| Step (run 1) | Expected | Actual |
|---|---|---|
| Block 1, archive, workstation (archive sha256 `2b088bf5b8f59fdf16c3153637341a090aecb7e8cfb1e733b310696ffb8745e8`) | 0 | 0 |
| Block 4, staging, workstation | 0, `R6 STAGE VERIFIED … (16 files)` | 0 |
| Block 5, re-check, workstation | 0 | 0 |
| Block 2, transfer to streamanator (`set -C`) ; bytes equal | 0 ; 0 | 0 ; 0 |
| Copy blocks/archive to the run directory; clean `git archive` export of the tested commit (`9bd34de0…`) | 0 ; 0 | 0 ; 0 |
| Containers on streamanator: pinned image `sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba` (Ubuntu 24.04.4), `--network none`, `--rm`, 25 runs | 0 | 0 (25 OK, 0 UNEXPECTED, 0 left) |
| Cleanup removed everything this run created, and only that | 0 | 0 |

Printed-block cases (one container each, as arm's uid under umask 0002, the case's own `/tmp`), all as expected:

| Block 4 (staging from an archive) | Expected | Block 5 (re-check of a root block 4 verified) | Expected |
|---|---|---|---|
| clean | 0 PASS | unchanged | 0 PASS |
| changed byte | 1 STOP | changed byte | 1 STOP |
| missing file | 1 STOP | missing file | 1 STOP |
| ordinary extra file | 1 STOP | ordinary extra file | 1 STOP |
| nested `docs/R6-SHA256SUMS` | 1 STOP | nested `docs/R6-SHA256SUMS` | 1 STOP |
| planted root `R6-SHA256SUMS` | 1 STOP | altered manifest (file and its pin changed together) | 1 STOP |
| extra symlink | 1 STOP | extra symlink | 1 STOP |
| expected file → symlink to identical bytes | 1 STOP | expected file → symlink to identical bytes | 1 STOP |
| truncated archive | 1 STOP | manifest → symlink to identical bytes | 1 STOP |
| not an archive | 1 STOP | hard link to a file outside the root | 1 STOP |
| | | group-writable file | 1 STOP |
| | | extra empty directory | 1 STOP |
| | | STAGE is a symlink to the verified root | 1 STOP |

Each case also prints a diagnostic that takes no part in the decision: whether `sha256sum -c` alone would have passed the judged
root. It returns 0 for 14 of the 19 negative cases that reach a staged root: extra file, nested manifest, extra symlink and
symlink to identical bytes (both blocks), and in block 5 the altered manifest, manifest symlink, hard link, group-writable file,
extra empty directory and symlinked STAGE. Only the manifest pin, the ownership/permission/link rule and the exact listing catch
those; the hashes alone catch only changed and missing bytes (and the planted root manifest).

Suite (`in-container.sh`) against the root clean block 4 staged: role prod **162 passed, 0 failed**; role wronghost **2 passed,
0 failed**. Sections:

- **H** handoff helper on fixture records (21 cases): the three valid outcomes, and a valid record with CRLF line endings, PASS;
  no record (exit 2), no handoff lines, two/repeated/missing/indented/ambiguous outcome lines, a short or upper-case ID,
  released without P5, released with a rollback line, released with Sunday's ID, an ID only on the handoff line, released with
  the old ID, an unverified rollback, a rollback with Sunday's ID, deferred with a non-Sunday ID, deferred with a promotion line:
  all STOP with no arguments printed.
- **U** A-2 usage: 16 malformed argument sets (count, prefixes, outcome/ID combinations outside the table) → exit 2, nothing
  checked.
- **O** the three outcomes, arguments copied from the handoff output: A-2 exit 0, `events.log` byte-identical.
- **R** the reported false PASS, per outcome × {`events.log` unreadable (mode 000), malformed (last record truncated),
  superseded by an unconfirmed `status-pass`}, after a later restart: r2's A-2 exits 0 (false PASS reproduced), plain status
  reports `STATUS PASS`, r3's A-2 exits 1 with exactly one FAIL, the InvocationID mismatch. `events.log` byte-identical in all 9.
- **I** A-2's own InvocationID read fails, is empty, malformed, multi-line or upper-case → exit 1.
- **C** wrong build id; unattested restart with an intact log (2 FAILs); promoted-not-restarted (r3 STOP; the `58e35ce8` A-2
  falsely passes).
- **S** stub status outputs: exact PASS → 0; PASS line with exit 1, wrong id, longer id, missing, duplicate, FAIL + PASS, restart
  note, **CRLF FAIL + LF PASS** (r2 contrast falsely passes), CRLF PASS line, a CR elsewhere → exit 1.
- **F** F-4 entry point: arm@afldb-prod runs the probe (24 connections) and exits 0, with FIFO detectors proving `.env` access,
  temp file and requests are observable; wrong user (ops) and wrong host (afldb-dev) exit 2 with no `.env` open, no temp file and
  no request; a changed helper exits 2; Sunday's bare helper on the wrong host reads `.env` and makes requests (the defect).

**A-2 read-only behaviour** (also in the runbook): it reads files, runs `release.mjs status` without `--expect` (writes nothing)
and `systemctl show` (read-only D-Bus query), and makes loopback health requests; those requests can produce ordinary service log
lines. It writes no file, no `events.log` line and no database row. Every suite run of A-2 compares `events.log` before and after.

## 5. Defect found during the proof, and fixed

The first proof run (tested commit then `dc88fe7f`; [`logs/proof-1-cleanup-defect-dc88fe7f.log`](logs/proof-1-cleanup-defect-dc88fe7f.log))
reported `R6 r3 REHEARSAL RESULT PASS` yet left its private run directory and the transferred archive on streamanator: Git Bash
rewrote the `/tmp/…` arguments of the remote cleanup call into Windows paths before `ssh.exe` saw them. The second (sabotaged)
run was then correctly refused because the archive path already existed. The leftovers were removed by exact path, the archive
only after matching run 1's hash. `9a9a01c1` runs the call with `MSYS_NO_PATHCONV=1` and makes cleanup a step: anything this run
created that survives makes the run fail. The proof wrapper now also fails on residue of any driver run, and requires the
sabotaged case to be reported UNEXPECTED (a refusal for another reason does not count). The runbook's operator lines already
pass each remote command as one quoted string; the amendment now says why.

## 6. Limits

- Containers emulate production with shims (`systemctl`, a fixture service process tree, fixture releases); they are not
  production. Real `release.mjs` from the tested commit is used.
- The workstation steps ran under Git Bash on Windows; the Linux steps ran in the pinned image on streamanator.
- Nothing here substitutes for Wednesday's live gates or Astra's review.

## 7. 27 November 2026: correction (finding 8) and driver amendment (finding 5)

Added on 27 Nov 2026. Nothing above was removed; `logs/` is byte-for-byte as committed on 24 Nov
(`proof-1-cleanup-defect-dc88fe7f.log` sha256 `a64292d6828af582b4fbb1c45ca0c3dd31828acc7d08624f14b3b20e63cdf425`,
`proof-2-tested-9a9a01c1.log` `6c49b37fc7f97d0ffd353fe5e4ee5df1e367ee46c041b523a9ba7807d1fe5b91`).

**Finding 8, printed-block comparison.** One statement was wrong and is corrected in §1: block 1 does *not* hash identically at
the tested commit and the review commit (`5152d440…` at `9a9a01c1`, `2d315073…` at `de106597` and `cdeaf31f`). Re-verified
unchanged on 27 Nov, each from the Git blobs or the committed log:

- §4's runbook, block 1–5 and verification-line hashes are exactly those of the review commit `de106597` (and of `cdeaf31f`),
  and are what `logs/proof-2-tested-9a9a01c1.log` prints for both runs; blocks 2–5 and the verification lines are also identical
  at `9a9a01c1`.
- Driver `run-printed-blocks.sh` at `9a9a01c1`: sha256 `abfaf65a5e1c5d303ea5c6545f9b44469d2e2046f24c33d173e36af3b70cd659`
  (the same blob at `de106597`, `cdeaf31f` and `aa33f0fc`).
- §2: all 16 per-file pins equal `git cat-file blob 9a9a01c1:<path> | sha256sum` and the same at `dc88fe7f`; the 16-line
  manifest cut from block 4 has digest `2c7ee8e2e1758f1002a36c4b75239d4ff4dea6958e7b2410a1f0253a38978007`; r2's
  `r6-pre-verify.sh` at `cc3369a5` is `0d9e97a5…`.
- §4: the block 1 archive of `9a9a01c1` re-derives to `2b088bf5b8f59fdf16c3153637341a090aecb7e8cfb1e733b310696ffb8745e8` and the
  fixture export to `9bd34de0768165573c96b5b9519a4c5251187082d7b9ec77eac1bfc7fc68d2f7` (git 2.56.0.windows.4); the log's counts
  (10 steps; 25 OK / 0 UNEXPECTED, then 24 / 1; 162 and 2 passed; exits 0 and 1; sentinels intact twice) are as tabled.
- §1: `git diff --stat 9a9a01c1 cdeaf31f` lists only the runbook, this README, the two logs, `issues.md`, `IssuesIndex.md` and
  `CHANGELOG.md`: no script, harness file or pinned file differs.

**Finding 5, the driver was amended in place on 27 Nov.** `run-printed-blocks.sh` and `prove-driver-fixes.sh` in this directory
are no longer the files the 24 Nov proof ran. **Every result in §4 and in `logs/` belongs to the driver at `9a9a01c1`**
(sha256 `abfaf65a…`; read it with
`git show 9a9a01c1:docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r3-20261124/run-printed-blocks.sh`; a snapshot is
also kept as `../review-fixes-r4-20261127/orig-aa33f0fc/r3-run-printed-blocks.sh`). What changed, and why:

- *Defect.* The `9a9a01c1` driver decided archive ownership from "the path exists" (workstation) and "`sha256sum` of the path
  printed something" (streamanator), and removed either archive when its bytes equalled this run's. Two runs of one revision
  write identical bytes: both pass the start check, and the one that cleans up first, or loses block 2's `set -C` create, or
  fails part-way, removes the other run's archive.
- *Rule now.* A run may remove an archive path only if that run created it by an atomic exclusive create that succeeded. On
  the workstation the driver reserves the path itself under noclobber with a marker naming its run id before block 1; printed
  block 1 then runs verbatim and `git archive --output=` writes into that reserved file. On streamanator, printed block 2's own
  `set -C` create is the reservation: ownership only if block 2 exited 0, and the bytes must equal what was sent. The losing
  side of a collision is REFUSED (exit 2, workstation) or STOPs (exit 1, streamanator), removes only what it owns, and leaves
  the other run's file untouched. Cleanup also requires the same file (device:inode) and this run's bytes.
- *Also.* An optional third argument `r3|r4` (default `r3`: the usage in §4 is unchanged) selects the amendment heading,
  archive path, staging-root pattern, harness directory, container runner and fixture export list; the runbook as cut is
  shipped to the run directory as `blocks/runbook.md`. A failed block 1 or block 2 now stops the run instead of continuing.
- *Proof and record.* Suite `../review-fixes-r4-20261127/cases/f5-cleanup-ownership.sh` (isolated; both sides; the exact race,
  a concurrent loop, partial failures, the original logic as contrast) and its wrapper
  `../review-fixes-r4-20261127/prove-archive-ownership.sh`. Results, and the r4 repeat of the sentinel proof, are recorded in
  [`../review-fixes-r4-20261127/README.md`](../review-fixes-r4-20261127/README.md), not here.
- The r2 driver in `../review-fixes-20261123/` is retired (it refuses to run); see its README.
