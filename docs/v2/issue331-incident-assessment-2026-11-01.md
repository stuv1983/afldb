# ISSUE-331 bounded incident assessment (2026-11-01)

Status: **assessment complete; cause of the deletions UNKNOWN; initiators NOT attributed.** Nothing here closes ISSUE-331.
It separates what the records demonstrate from what they only suggest, and ends with a concrete owner disposition.

Scope and method. Read-only, metadata and log inspection of the three named roots only: `D:\tmp\afldb-v2-pg16` (isolated PostgreSQL
root), `D:\afldb-v2-rehearsal-20261020` (frozen WSL rehearsal store) and the WSL export copy
`AFLDB-V2-BrownlowExport-20261028` (base `C:\afldb-v2-brownlow-export-20261028`). Nothing was mounted, started, hashed, modified,
re-pinned or re-credentialled. No forensic tool was installed and no drive was scanned. Sources, all local and narrowly filtered:
`Microsoft-Windows-VHDMP-Operational`, `System` (boot/shutdown/power/time), `Microsoft-Windows-Ntfs/Operational` (hourly free-space
summaries; the elevated USN journal was not available, the shell is not elevated), `Microsoft-Windows-Windows Defender/Operational`,
`Application`, the WSL registration keys, file metadata, the user's PowerShell history filtered on the named paths, the Recycle Bin,
and this project's Claude Code session transcripts filtered on delete/`wsl` commands. All times are local (AEDT, UTC+11) unless
marked Z. The Codex tooling's own session records were deliberately not read (outside the named roots).

## 1. Demonstrated facts

**F1. The frozen original was attached read-write and written to on 2026-10-31.**
The VHDMP log records `D:/afldb-v2-rehearsal-20261020\ext4.vhdx` and `C:\afldb-v2-brownlow-export-20261028\ext4.vhdx` surfaced
into one WSL utility VM (VM ID `b1d52a47-8355-4e83-830d-d7cb47219bbe`; handle `ReadOnly = false`, `WriteDepth = 1`) at **10:36:55**
(original) and **10:36:58** (copy). No detach event for either is logged afterwards. The hourly I/O summaries for the original show
**19.19 GB written** (15.44 GB to 11:36, 2.38 GB to 12:36, 1.37 GB to 19:37) and 30.49 GB read (mostly 25.86 GB in the hour to
12:36). The copy shows 0.69 GB read and 0.02 GB written in the first hour and nothing after. Earlier attach windows for the same
disks are the documented ones: original 2026-10-26 10:02-10:15, copy 2026-10-28 14:39-16:38.
Consequence: the size and mtime change of `ext4.vhdx` (37,885,050,880 to 47,045,410,816 bytes, +9,160,359,936; mtime 2026-10-31
20:33:45) is explained mechanically by a writable WSL session on that day. It is no longer an unexplained drift in kind; **who or what
started that session is not recorded in any log examined.**

**F2. The machine was hard-reset that evening.**
`System` records an unexpected shutdown with last-alive timestamp 20:09:47, an OS start at 20:36:50, a second unexpected shutdown
at 20:37:19 (Kernel-Power 41, `BugcheckCode` 0, i.e. not a bugcheck; the second carries a power-button timestamp of 20:37:28) and
an OS start at 20:37:54. The original's last write (20:33:45) falls inside that unclean-shutdown window with the disk still attached
and no logged detach. The disk was not checked after the resets, so its internal filesystem state is unknown.

**F3. The export copy's base directory was removed by file deletion, not by WSL unregistration, between about 00:38 and 01:29 on 2026-11-01.**
The registration key still exists (`BasePath \\?\C:\afldb-v2-brownlow-export-20261028`, `State 1`); `wsl --unregister` would have
removed it. The base existed when documented on 2026-10-28 and was still attached with logged I/O at 11:36 on 2026-10-31; a
`Test-Path` on it returned **False at 01:29** on 2026-11-01 (session transcript, 2026-10-31T14:29Z). The NTFS hourly summary for `C:` to 01:38 shows available space between 34.72 GB and 75.14 GB, a
40.42 GB swing; the recorded size of the copy's disk is 40,905,998,336 bytes. That is consistent with the file's removal in the
00:38-01:38 interval; it is a correlation, not a proof. The user's PowerShell history contains no command naming the path, and the
Recycle Bin is empty (a disk this size would bypass it, so that is weak evidence).

**F4. The isolated root lost specific subtrees, not everything, with a precise time.**
Surviving under `dist\pgsql\bin` are exactly 13 files: `postgres.exe` and 12 DLLs (`icudt67`, `icuin67`, `icuuc67`,
`libcrypto-3-x64`, `libiconv-2`, `libintl-9`, `liblz4`, `libssl-3-x64`, `libwinpthread-1`, `libxml2`, `libzstd`, `zlib1`): the
executable image and libraries mapped by the running postmaster, which Windows will not delete. Everything else under `dist\pgsql`
(`lib`, `share`, `pg_ctl`, the other tools), plus `secrets\` and `download\`, is gone. `data\` and `logs\` are intact. The last
directory change in `dist\pgsql\bin` is **00:50:54** and the first logged failure is 00:51:04, ten seconds later. The pattern is
what a recursive delete of `secrets`, `download` and `dist` would leave when it is blocked only on in-use files.

**F5. Ruled out as causes, on the records examined.**
- Microsoft Defender: **zero** detection, remediation or quarantine events (ids 1006-1009, 1116-1119) from 2026-10-26 to
  2026-11-01 03:00; only routine configuration-hash change notices.
- Storage faults: no disk, volmgr or NTFS error events in the window; the one NTFS latency warning names an unrelated
  `chrome.exe` file.
- Disk exhaustion at the time of loss: `D:` held at 2.45-3.9 GB available through 31 Oct, but the interval summary to 01:38 shows
  at least 62.8 GB available throughout, so `D:` was not full at 00:50.
- WSL unregistration of the copy (F3) and a Windows update/reboot at the time (no boot events between 20:37:54 on 31 Oct and the
  assessment).
- This project's own Claude Code sessions: seven transcripts covering 2026-10-31 21:59 to 2026-11-01 06:33 contain **no** delete,
  `--unregister` or `wsl --shutdown`/start command naming the three stores. Their deletes are `rm -rf /d/tmp/afldb-gap006-visual-20261031`
  (a scratch directory, 23:44) and repository evidence directories. One session started an integration run through
  `tools/v2/isolated-pg.ts` at 00:50:15, 39 seconds before the F4 directory change; the seven test files in that run contain no
  filesystem delete (their `child_process` use is Python `psycopg` probes), and `isolated-pg.ts`'s only unlink removes a
  pending-marker file. This is **adjacency without a mechanism**, recorded so it is not rediscovered as a lead.

**F6. Other documented retained locations are also absent, and `D:` was bulk-reclaimed.**
Absent now: `D:\tmp\afldb-v2-b1wsl-20261028` (WSL evidence copy, manifest `34cf4f8e...`), `D:\tmp\afldb-v2-i265b-20261028`,
`D:\tmp\afldb-v2-rebuild-capture`, and `D:\tmp\afldbV2-source-snapshot-20261019` (the 2026-10-19 preservation snapshot cited by
`docs/v2/baseline.md` and `final-report.md`; the 19 files themselves are in V2 commit `c9cca86d`, but the snapshot's status and
patch records are not). Present: `D:\tmp\afldb-gap006-brownlow-artifacts-20261101`, `D:\tmp\afldb-gap006-recovery-20261101`, the
original isolated root and the frozen rehearsal root. The NTFS summaries show `D:` free space rising by 60.51 GB (interval to
00:38) and 68.61 GB (interval to 01:38), about 129 GB in total, while the frozen disk (47 GB) remains. The 23:44 `rm -rf` of the
visual scratch directory lies inside the first interval and may account for part of it; **nothing in the records accounts for the
rest.**

## 2. Hypotheses (not demonstrated; do not treat as findings)

- **H1.** One space-reclamation clean-up, by an agent session or by hand, removed the export copy, several `D:\tmp` scratch and
  evidence directories, and the `secrets`/`download`/`dist` subtrees of the isolated root, while `D:` was nearly full. Supported by F3,
  F4, F6 and the free-space series; not supported by any record that names an actor.
- **H2.** A tool that enumerates registered WSL distributions started the 10:36 session (both disks attached within three seconds).
  Supported only by the timing.
- **H3.** The delete of F4 was a deliberate credential/binary clean-up of the isolated root (it removed `secrets\`). No evidence either way.
- H1-H3 are independent; any, all or none may hold. The attribution gap is **retained uncertainty**.

## 3. Integrity consequences (historical proof stays historical)

- The 2026-10-28 binding of the original (`ext4.vhdx` 37,885,050,880 bytes, mtime 2026-10-25T23:15:52Z, sha256 `589597c5...`)
  was true when recorded and is **historical only**. The original is now a **changed store**. It is not a baseline, must not be
  re-hashed and re-pinned as if it were the frozen artefact, and no gate or claim may rest on it.
- Results that previously depended on the frozen store were re-derived from independently verified inputs on 2026-11-01 (the
  Brownlow artefacts from DEV, consistent with the record but not a proven historical full-hash match; 8/8 isolated result). That
  limitation stands.
- The export copy is gone. Its exposed-credential problem (same passwords as the original, recorded 2026-10-28) is **not** resolved
  by its disappearance: the original and earlier transcripts still carry those passwords.
- The isolated root `D:\tmp\afldb-v2-pg16` is a **changed environment**. Its data directory was verified intact and identical to the
  cold backup and the recovery copy (manifest sha256 `b32809e8...b033`); that manifest, not the original root, is the reference.
- The preservation snapshot loss weakens, but does not remove, the provenance in `docs/v2/baseline.md`: the imported files are in
  Git; only the snapshot's capture-time status/patch records are unrecoverable.

## 4. Owner disposition (recommended; none is executed)

| ID | Decision | Recommendation |
|---|---|---|
| D-331-1 | Accept this assessment as the incident record: facts F1-F6, hypotheses H1-H3 unproven, cause UNKNOWN, no actor attributed | Accept. Further inquiry would need the Codex tool's own records or an elevated USN-journal read, both outside this assessment's authority |
| D-331-2 | Frozen original `AFLDB-V2-Rehearsal-20261020` | **Quarantine**: classify as CHANGED, never boot or hash it as evidence, keep it until you confirm nothing else needs its 2025 template or production-restore content (every artefact needed since has been re-obtained). Retirement (`wsl --unregister` and deleting the base) is yours to run later and is irreversible. Rotate the shared role passwords by retiring it rather than by editing it |
| D-331-3 | Dangling `AFLDB-V2-BrownlowExport-20261028` registration | Run `wsl --unregister AFLDB-V2-BrownlowExport-20261028` yourself. It has no disk, so nothing is lost; it removes a misleading registration |
| D-331-4 | Future use of the changed stores | The only sanctioned isolated environment is the verified recovery copy (or a new root built from the vendor binaries), referenced by manifest `b32809e8...b033`. The original root stays untouched; delete it when you no longer want the cold-backup comparison |
| D-331-5 | Closure | Either close ISSUE-331 as "cause unestablished, accepted by owner, with the retained uncertainty above" once D-331-1 to D-331-4 are recorded, or keep it open until an initiator is identified. Recommended: close on those terms |

Preventive measures worth considering (not implemented, not required for closure): keep the retained stores on a volume that is
never the scratch volume; make retained evidence read-only at the file level; alert on `D:` below 10 GB; treat an operation that
needs space as a prompt to ask rather than reclaim.
